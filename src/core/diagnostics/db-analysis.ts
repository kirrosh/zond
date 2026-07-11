import { getDb } from "../../db/schema.ts";
import { listCollections, listRuns, getRunById, getResultsByRunId, getCollectionById } from "../../db/queries.ts";
import { join } from "node:path";
import { classifyFailure, recommendedActionForGenerated, isGeneratedTest, type RecommendedAction } from "./failure-hints.ts";
import { buildSuggestedFixes, type SuggestedFix } from "./suggested-fixes.ts";

function truncateErrorMessage(raw: string | null | undefined, verbose?: boolean): string | undefined {
  if (!raw) return undefined;
  if (verbose || raw.length < 500) return raw;
  const lines = raw.split(/\r?\n/);
  const msgLines = [lines[0]!];
  let traceCount = 0;
  for (let i = 1; i < lines.length && traceCount < 3; i++) {
    const line = lines[i]!;
    if (/^\s+/.test(line) || /^\s*at\s/.test(line)) {
      msgLines.push(line);
      traceCount++;
    }
  }
  const remaining = lines.length - msgLines.length;
  if (remaining > 0) {
    msgLines.push(`...[truncated ${remaining} lines]`);
  }
  return msgLines.join("\n");
}

/**
 * ARV-305: build a short reason string for `by_recommended_action.examples`.
 *
 * Preference order:
 *   1. trimmed `error_message` (assertion- or network-level message)
 *   2. first failing assertion → `<field> <rule>: got <actual>`
 *   3. undefined (nothing left to say)
 *
 * Without (2) every assertion-only failure leaves examples[].reason as
 * undefined, so triage agents lose the one signal that lets them route
 * past method/path/status (regenerate_suite vs tighten_validation
 * collapse to identical-looking buckets).
 */
function buildExampleReason(
  errorMessage: unknown,
  assertions: unknown,
): string | undefined {
  const trim = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}...` : s);
  if (typeof errorMessage === "string" && errorMessage.length > 0) {
    return trim(errorMessage);
  }
  if (!Array.isArray(assertions)) return undefined;
  for (const a of assertions) {
    if (!a || typeof a !== "object") continue;
    const row = a as Record<string, unknown>;
    if (row.passed === false) {
      const field = typeof row.field === "string" ? row.field : "";
      const rule = typeof row.rule === "string" ? row.rule : "";
      const actual = "actual" in row ? row.actual : undefined;
      const actualStr = actual === undefined || actual === null
        ? ""
        : typeof actual === "string"
          ? actual
          : JSON.stringify(actual);
      const parts = [field, rule].filter(Boolean).join(" ");
      const text = actualStr ? `${parts}: got ${actualStr}` : parts;
      return text ? trim(text) : undefined;
    }
  }
  return undefined;
}

function parseBodySafe(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  const truncated = raw.length > 2000 ? raw.slice(0, 2000) + "\u2026[truncated]" : raw;
  try {
    return JSON.parse(raw);
  } catch {
    return truncated;
  }
}

const USEFUL_HEADERS = new Set([
  "content-type", "content-length", "location", "retry-after",
  "www-authenticate", "allow",
]);
const USEFUL_PREFIXES = ["x-", "ratelimit"];

/** ARV-103 (F8): true when at least one assertion on the failing step is
 *  a schema-validation kind. `--validate-schema` annotates each violated
 *  field with `kind: "schema"` (set in src/core/runner/schema-validator.ts).
 *  The assertions column is stored as JSON in SQLite; parse defensively. */
function hasSchemaAssertion(raw: string | unknown[] | null | undefined): boolean {
  if (raw === null || raw === undefined) return false;
  let arr: unknown[];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return false;
      arr = parsed;
    } catch {
      return false;
    }
  } else {
    return false;
  }
  for (const a of arr) {
    if (a && typeof a === "object" && (a as { kind?: unknown }).kind === "schema") return true;
  }
  return false;
}

function filterHeaders(raw: string | null | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const h = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(h)) {
      const l = k.toLowerCase();
      if (USEFUL_HEADERS.has(l) || USEFUL_PREFIXES.some(p => l.startsWith(p))) {
        out[k] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch { return undefined; }
}

export interface RunDetail {
  run: {
    id: number;
    started_at: string;
    finished_at: string | null;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    trigger: string | null;
    environment: string | null;
    duration_ms: number | null;
  };
  results: Array<{
    suite_name: string;
    test_name: string;
    status: string;
    duration_ms: number | null;
    request_method: string | null;
    request_url: string | null;
    request_body: string | null;
    response_status: number | null;
    response_body: string | null;
    response_headers: string | null;
    error_message?: string;
    assertions: unknown;
  }>;
}

export function getRunDetail(runId: number, verbose?: boolean, dbPath?: string): RunDetail {
  getDb(dbPath);
  const run = getRunById(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const results = getResultsByRunId(runId);
  return {
    run: {
      id: run.id,
      started_at: run.started_at,
      finished_at: run.finished_at,
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      skipped: run.skipped,
      trigger: run.trigger,
      environment: run.environment,
      duration_ms: run.duration_ms,
    },
    results: results.map(r => ({
      suite_name: r.suite_name,
      test_name: r.test_name,
      status: r.status,
      duration_ms: r.duration_ms,
      request_method: r.request_method,
      request_url: r.request_url,
      // bodies are already redacted + truncated at write time (ARV-432)
      request_body: r.request_body,
      response_status: r.response_status,
      response_body: r.response_body,
      response_headers: r.response_headers,
      error_message: truncateErrorMessage(r.error_message, verbose),
      assertions: r.assertions,
    })),
  };
}

export interface FailureGroup {
  pattern: string;
  count: number;
  failure_type: string;
  recommended_action: RecommendedAction;
  examples: string[];
  response_status: number | null;
}

export interface CascadeSkipGroup {
  capture_var: string;
  count: number;
  examples: string[];
}

export interface DiagnoseResult {
  run: {
    id: number;
    started_at: string;
    environment: string | null;
    duration_ms: number | null;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    api_errors: number;
    assertion_failures: number;
    network_errors: number;
  };
  cascade_skips?: CascadeSkipGroup[];
  /** TASK-29: actionable suggestions populated from 404 placeholder
   *  detection + .env.yaml unfilled-key audit. Empty / undefined when
   *  nothing actionable was found. */
  suggested_fixes?: SuggestedFix[];
  failures: Array<{
    suite_name: string;
    test_name: string;
    suite_file?: string;
    status: string;
    failure_type: string;
    recommended_action: RecommendedAction;
    error_message?: string;
    request_method: string | null;
    request_url: string | null;
    response_status: number | null;
    response_body?: unknown;
    response_headers?: Record<string, string>;
    assertions: unknown;
    duration_ms: number | null;
    /** ARV-159: when this entry is the representative of a collapsed group
     *  (status|failure_type signature), the total size of that group. Lets
     *  consumers reading `.data.failures[]` see "this signature stands for
     *  N underlying tests" without cross-referencing `.grouped_failures[]`.
     *  Omitted when no collapsing occurred (failures ≤ 5 or
     *  --verbose). */
    group_count?: number;
  }>;
  grouped_failures?: FailureGroup[];
  /** ARV-101 (F6): top-level aggregation keyed by `recommended_action`
   *  enum so triage agents (zond-triage skill) can route on the canonical
   *  action without re-folding `failures[].recommended_action` through
   *  `jq | group_by`. Built from the *full* failure set (not the compact
   *  subset), so counts match `.summary.failed`. Each bucket carries
   *  total count + a small examples list (`<suite>/<test>`). Empty when
   *  there are no failures. */
  by_recommended_action?: Record<string, {
    count: number;
    /** ARV-228: each example carries the per-failure context the
     *  zond-triage skill renders in its output template (`POST
     *  /v1/projects → 500 (×3) — <reason>`). Previously a bare
     *  `string[]` of `<suite>/<test>` ids — agents had to cross-join
     *  with `failures[]` to recover method/path/status, which broke
     *  triage scripts on large runs. Bounded to 5 entries per bucket
     *  (same cap as the legacy string form). */
    examples: Array<{
      suite: string;
      test: string;
      method: string;
      path: string;
      status: number;
      reason?: string;
    }>;
  }>;
}

export function diagnoseRun(runId: number, verbose?: boolean, dbPath?: string, maxExamples?: number): DiagnoseResult {
  getDb(dbPath);
  const diagRun = getRunById(runId);
  if (!diagRun) throw new Error(`Run ${runId} not found`);

  let envFilePath: string | undefined;
  if (diagRun.collection_id) {
    const collection = getCollectionById(diagRun.collection_id);
    if (collection?.base_dir) {
      envFilePath = join(collection.base_dir, ".env.yaml").replace(/\\/g, "/");
    }
  }

  const allResults = getResultsByRunId(runId);
  const failures = allResults
    .filter(r => r.status === "fail" || r.status === "error")
    .map(r => {
      const parsedBody = parseBodySafe(r.response_body);
      const failure_type = classifyFailure(r.status, r.response_status);
      // ARV-42: generator-emitted suites should not route to fix_test_logic —
      // editing the YAML gets clobbered on the next `zond audit`.
      const generated = isGeneratedTest(r.provenance, r.suite_file);
      // ARV-103 (F8): walk the assertions array to detect a schema-kind
      // failure (--validate-schema annotates each assertion with its kind).
      // When present, propagate the flag so the classifier routes to
      // report_backend_bug — schema violations are real contract bugs, not
      // test-logic mistakes.
      const schema_violation = hasSchemaAssertion(r.assertions);
      const rec_action = recommendedActionForGenerated(failure_type, r.response_status, generated, schema_violation);
      return {
        suite_name: r.suite_name,
        test_name: r.test_name,
        ...(r.suite_file ? { suite_file: r.suite_file } : {}),
        status: r.status,
        failure_type,
        recommended_action: rec_action,
        error_message: truncateErrorMessage(r.error_message, verbose),
        request_method: r.request_method,
        request_url: r.request_url,
        response_status: r.response_status,
        response_body: parsedBody,
        response_headers: filterHeaders(r.response_headers),
        assertions: r.assertions,
        duration_ms: r.duration_ms,
      };
    });

  let apiErrors = 0, assertionFailures = 0, networkErrors = 0;
  for (const f of failures) {
    if (f.failure_type === "api_error") apiErrors++;
    else if (f.failure_type === "assertion_failed") assertionFailures++;
    else if (f.failure_type === "network_error") networkErrors++;
  }

  // Cascade skips: skipped tests due to missing captures from failed create steps
  const CASCADE_RE = /^Depends on missing capture: (.+)$/;
  const groupMap = new Map<string, string[]>();
  for (const r of allResults) {
    if (r.status !== "skip") continue;
    const match = CASCADE_RE.exec(r.error_message ?? "");
    if (!match) continue;
    const captureVar = match[1]!;
    const existing = groupMap.get(captureVar) ?? [];
    existing.push(`${r.suite_name}/${r.test_name}`);
    groupMap.set(captureVar, existing);
  }
  const cascade_skips: CascadeSkipGroup[] | undefined = groupMap.size > 0
    ? [...groupMap.entries()].map(([capture_var, examples]) => ({
        capture_var,
        count: examples.length,
        examples: examples.slice(0, 3),
      }))
    : undefined;

  const { grouped_failures, compactFailures } = verbose
    ? { grouped_failures: undefined, compactFailures: failures }
    : groupFailures(failures, maxExamples);

  // TASK-29: surface placeholder path-params + unfilled .env.yaml keys.
  const suggestedFixes = buildSuggestedFixes({
    failures: failures.map(f => ({
      response_status: f.response_status,
      request_url: f.request_url,
      suite_name: f.suite_name,
      test_name: f.test_name,
    })),
    envFilePath,
  });

  // ARV-101 (F6): aggregate failures by recommended_action enum so triage
  // agents read .data.by_recommended_action.fix_env.count instead of
  // re-folding failures[].recommended_action through `jq | group_by`. Built
  // from the full failure set (not compactFailures) so counts match
  // .summary.failed. Bounded examples list (5) keeps payload small while
  // still pointing at concrete suites the agent can open.
  //
  // ARV-228: each example is now an object carrying method/path/status/
  // reason so the zond-triage skill can render its output template
  // ("POST /v1/projects → 500 (×3) — TypeError") without cross-joining
  // failures[]. Bound preserved at 5/bucket; ordering = insertion order
  // (matches failures[] traversal, deterministic per run).
  const by_recommended_action: Record<string, NonNullable<DiagnoseResult["by_recommended_action"]>[string]> = {};
  for (const f of failures) {
    const key = f.recommended_action;
    let bucket = by_recommended_action[key];
    if (!bucket) {
      bucket = { count: 0, examples: [] };
      by_recommended_action[key] = bucket;
    }
    bucket.count += 1;
    if (bucket.examples.length < 5) {
      // Trim reason to keep the bucket compact — full error_message lives
      // in failures[].error_message for agents that want it.
      //
      // ARV-305: when there is no top-level error_message (typical for
      // assertion failures — the row carries the failing rule in
      // .assertions, not a free-form message), build a reason out of
      // the first failing assertion so the example is not stripped
      // down to method/path/status. The fallback keeps the field
      // populated whenever any failure context exists.
      const reason = buildExampleReason(f.error_message, f.assertions);
      bucket.examples.push({
        suite: f.suite_name,
        test: f.test_name,
        // DB columns are nullable (early steps may not have a request
        // recorded yet — e.g. fixture-load failures). Coerce to "" / 0
        // rather than leaking null into the contract.
        method: f.request_method ?? "",
        path: f.request_url ?? "",
        status: f.response_status ?? 0,
        ...(reason ? { reason } : {}),
      });
    }
  }

  return {
    run: {
      id: diagRun.id,
      started_at: diagRun.started_at,
      environment: diagRun.environment,
      duration_ms: diagRun.duration_ms,
    },
    summary: {
      total: diagRun.total,
      passed: diagRun.passed,
      failed: diagRun.failed,
      api_errors: apiErrors,
      assertion_failures: assertionFailures,
      network_errors: networkErrors,
    },
    ...(cascade_skips ? { cascade_skips } : {}),
    ...(suggestedFixes.length > 0 ? { suggested_fixes: suggestedFixes } : {}),
    failures: compactFailures,
    ...(grouped_failures ? { grouped_failures } : {}),
    ...(failures.length > 0 ? { by_recommended_action } : {}),
  };
}

type FailureItem = { suite_name: string; test_name: string; failure_type: string; recommended_action: RecommendedAction; response_status: number | null; group_count?: number };

/** Group similar failures for compact output. Exported for testing. */
export function groupFailures<T extends FailureItem>(failures: T[], maxExamples = 2): { grouped_failures?: FailureGroup[]; compactFailures: T[] } {
  if (failures.length <= 5) {
    return { compactFailures: failures };
  }

  const groupMap = new Map<string, { items: T[]; failure_type: string; response_status: number | null }>();

  for (const f of failures) {
    const key = `${f.response_status ?? "null"}|${f.failure_type}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.items.push(f);
    } else {
      groupMap.set(key, {
        items: [f],
        failure_type: f.failure_type,
        response_status: f.response_status,
      });
    }
  }

  const hasGroups = [...groupMap.values()].some(g => g.items.length > 2);
  if (!hasGroups) {
    return { compactFailures: failures };
  }

  const grouped_failures: FailureGroup[] = [];
  const compactFailures: T[] = [];

  for (const [, group] of groupMap) {
    const pattern = group.response_status
      ? `${group.response_status} ${group.failure_type}`
      : group.failure_type;
    // 5xx (api_error) are critical backend bugs — never collapse them.
    // Diagnose must surface every 5xx, otherwise users miss real
    // regressions hidden behind a single sample.
    const isApiError = group.failure_type === "api_error";
    const showAll = isApiError || maxExamples === 0;
    grouped_failures.push({
      pattern,
      count: group.items.length,
      failure_type: group.failure_type,
      recommended_action: group.items[0]!.recommended_action,
      examples: (showAll ? group.items : group.items.slice(0, maxExamples)).map(f => `${f.suite_name}/${f.test_name}`),
      response_status: group.response_status,
    });
    if (isApiError) {
      compactFailures.push(...group.items);
    } else {
      // ARV-159: tag the representative with the group size so
      // `.data.failures[]` carries the multiplier inline.
      const rep = { ...group.items[0]!, group_count: group.items.length };
      compactFailures.push(rep as T);
    }
  }

  return { grouped_failures, compactFailures };
}

export interface BodyFieldChange {
  field: string;
  change: "added" | "removed" | "type_changed";
  before?: string;
  after?: string;
  /** ARV-352: structural scope of the change, derived deterministically from
   *  the path. `element` = the path crosses an array boundary (`[]`), i.e.
   *  it's a field of a *collection item* — on list/log endpoints two samplings
   *  return DIFFERENT objects, so element-level added/removed/type_changed is
   *  schema-of-union variance across the sampled set, not a contract move.
   *  `container` = no `[]` in the path — the response envelope/pagination
   *  skeleton, where a change IS real drift. NOT a suppression heuristic
   *  (ARV-337): nothing is dropped or down-ranked; the agent judges using the
   *  scope tag + endpoint context. */
  scope: "container" | "element";
}

export interface BodyDiff {
  suite: string;
  test: string;
  changes: BodyFieldChange[];
}

export interface CompareResult {
  runA: { id: number; started_at: string };
  runB: { id: number; started_at: string };
  summary: {
    regressions: number;
    fixes: number;
    unchanged: number;
    newTests: number;
    removedTests: number;
    bodyChanges: number;
    /** ARV-352: of `bodyChanges`, how many touch the response envelope
     *  (`container`) vs collection-item fields (`element`). Element-heavy diffs
     *  on list/log endpoints are schema-of-union variance across a re-sampled
     *  set, not contract drift — split so triage doesn't read them as regression. */
    bodyChangesContainer: number;
    bodyChangesElement: number;
  };
  regressions: Array<{ suite: string; test: string; before: string; after: string }>;
  fixes: Array<{ suite: string; test: string; before: string; after: string }>;
  /** ARV-339: field-level response-shape diff for tests present in both runs.
   *  Status-diff answers "what broke"; this answers "how the contract moved". */
  body_changes: BodyDiff[];
  hasRegressions: boolean;
}

/** ARV-339: flatten a parsed JSON body into `path → union of leaf types`.
 *  Array elements collapse under `[]` so item count/order don't add noise. */
function bodyShape(value: unknown, path: string, out: Map<string, Set<string>>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) addShape(out, path, "array");
    for (const item of value) bodyShape(item, `${path}[]`, out);
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) addShape(out, path, "object");
    for (const [k, v] of entries) bodyShape(v, path ? `${path}.${k}` : k, out);
  } else {
    addShape(out, path, value === null ? "null" : typeof value);
  }
}

function addShape(out: Map<string, Set<string>>, path: string, type: string): void {
  const key = path || "$";
  const set = out.get(key) ?? new Set<string>();
  set.add(type);
  out.set(key, set);
}

const typeLabel = (s: Set<string>): string => [...s].sort().join("|");

/** ARV-339: diff two stored response bodies at field level. Returns [] when
 *  either side is missing / non-JSON — a shape diff of prose is meaningless. */
export function diffBodyShapes(rawA: string | null, rawB: string | null): BodyFieldChange[] {
  if (!rawA || !rawB || rawA === rawB) return [];
  let a: unknown, b: unknown;
  try { a = JSON.parse(rawA); b = JSON.parse(rawB); } catch { return []; }
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return [];
  const shapeA = new Map<string, Set<string>>();
  const shapeB = new Map<string, Set<string>>();
  bodyShape(a, "", shapeA);
  bodyShape(b, "", shapeB);
  const scopeOf = (field: string): "container" | "element" =>
    field.includes("[]") ? "element" : "container";
  const changes: BodyFieldChange[] = [];
  for (const [field, typesB] of shapeB) {
    const typesA = shapeA.get(field);
    if (!typesA) changes.push({ field, change: "added", after: typeLabel(typesB), scope: scopeOf(field) });
    else if (typeLabel(typesA) !== typeLabel(typesB)) {
      changes.push({ field, change: "type_changed", before: typeLabel(typesA), after: typeLabel(typesB), scope: scopeOf(field) });
    }
  }
  for (const [field, typesA] of shapeA) {
    if (!shapeB.has(field)) changes.push({ field, change: "removed", before: typeLabel(typesA), scope: scopeOf(field) });
  }
  return changes.sort((x, y) => x.field.localeCompare(y.field));
}

export function compareRuns(idA: number, idB: number, dbPath?: string): CompareResult {
  getDb(dbPath);
  const runARecord = getRunById(idA);
  const runBRecord = getRunById(idB);
  if (!runARecord) throw new Error(`Run #${idA} not found`);
  if (!runBRecord) throw new Error(`Run #${idB} not found`);

  const resultsA = getResultsByRunId(idA);
  const resultsB = getResultsByRunId(idB);

  const mapA = new Map<string, string>();
  const mapB = new Map<string, string>();
  const bodyA = new Map<string, string | null>();
  const bodyB = new Map<string, string | null>();
  for (const r of resultsA) {
    mapA.set(`${r.suite_name}::${r.test_name}`, r.status);
    bodyA.set(`${r.suite_name}::${r.test_name}`, r.response_body);
  }
  for (const r of resultsB) {
    mapB.set(`${r.suite_name}::${r.test_name}`, r.status);
    bodyB.set(`${r.suite_name}::${r.test_name}`, r.response_body);
  }

  const regressions: Array<{ suite: string; test: string; before: string; after: string }> = [];
  const fixes: Array<{ suite: string; test: string; before: string; after: string }> = [];
  let unchanged = 0;
  let newTests = 0;
  let removedTests = 0;

  const body_changes: BodyDiff[] = [];

  for (const [key, statusB] of mapB) {
    const statusA = mapA.get(key);
    if (statusA === undefined) { newTests++; continue; }
    const [suite, test] = key.split("::") as [string, string];
    const changes = diffBodyShapes(bodyA.get(key) ?? null, bodyB.get(key) ?? null);
    if (changes.length > 0) body_changes.push({ suite, test, changes });
    const wasPass = statusA === "pass";
    const isPass = statusB === "pass";
    const wasFail = statusA === "fail" || statusA === "error";
    const isFail = statusB === "fail" || statusB === "error";
    if (wasPass && isFail) regressions.push({ suite, test, before: statusA, after: statusB });
    else if (wasFail && isPass) fixes.push({ suite, test, before: statusA, after: statusB });
    else unchanged++;
  }
  for (const key of mapA.keys()) {
    if (!mapB.has(key)) removedTests++;
  }

  return {
    runA: { id: idA, started_at: runARecord.started_at },
    runB: { id: idB, started_at: runBRecord.started_at },
    summary: {
      regressions: regressions.length,
      fixes: fixes.length,
      unchanged,
      newTests,
      removedTests,
      bodyChanges: body_changes.length,
      bodyChangesContainer: body_changes.filter(d => d.changes.some(c => c.scope === "container")).length,
      bodyChangesElement: body_changes.filter(d => d.changes.every(c => c.scope === "element")).length,
    },
    regressions,
    fixes,
    body_changes,
    hasRegressions: regressions.length > 0,
  };
}

export function getCollections(dbPath?: string) {
  getDb(dbPath);
  return listCollections();
}

export function getRuns(limit?: number, dbPath?: string) {
  getDb(dbPath);
  return listRuns(limit ?? 20);
}
