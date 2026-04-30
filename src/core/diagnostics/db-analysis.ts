import { getDb } from "../../db/schema.ts";
import { listCollections, listRuns, getRunById, getResultsByRunId, getCollectionById } from "../../db/queries.ts";
import { join } from "node:path";
import { statusHint, classifyFailure, envHint, envCategory, schemaHint, computeSharedEnvIssue, clusterEnvIssues, buildEnvIssue, recommendedAction, softDeleteHint, type RecommendedAction, type EnvIssue } from "./failure-hints.ts";
import { AUTH_PATH_RE } from "../runner/execute-run.ts";

export function truncateErrorMessage(raw: string | null | undefined, verbose?: boolean): string | undefined {
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

export function parseBodySafe(raw: string | null | undefined): unknown {
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

export function filterHeaders(raw: string | null | undefined): Record<string, string> | undefined {
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
    response_status: number | null;
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
      response_status: r.response_status,
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
  hint?: string;
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
  agent_directive?: string;
  env_issue?: EnvIssue;
  auth_hint?: string;
  cascade_skips?: CascadeSkipGroup[];
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
    hint?: string;
    schema_hint?: string;
    response_body?: unknown;
    response_headers?: Record<string, string>;
    assertions: unknown;
    duration_ms: number | null;
  }>;
  grouped_failures?: FailureGroup[];
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
      const hint = envHint(r.request_url, r.error_message, envFilePath) ??
        softDeleteHint(r.response_status, r.request_method, parsedBody) ??
        statusHint(r.response_status);
      const failure_type = classifyFailure(r.status, r.response_status);
      const rec_action = recommendedAction(failure_type, r.response_status);
      const sHint = schemaHint(failure_type, r.response_status);
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
        ...(hint ? { hint } : {}),
        ...(sHint ? { schema_hint: sHint } : {}),
        response_body: parsedBody,
        response_headers: filterHeaders(r.response_headers),
        assertions: r.assertions,
        duration_ms: r.duration_ms,
      };
    });

  // TASK-70 + TASK-98 — env_issue detector.
  //
  // Two passes:
  //   1. Run-level: if every non-5xx failure shares a single env-category,
  //      treat it as a global env_issue (legacy TASK-70 behaviour). This
  //      catches the most common case — base_url unset, every test broken.
  //   2. Suite-level clustering: group failures by suite, flag each suite
  //      whose non-5xx failures are ≥80% env-symptomatic (TASK-98). Catches
  //      per-suite missing variables, expired auth tokens, dead webhook
  //      hosts — situations where the run is *mixed* but a specific suite
  //      is clearly env-broken.
  //
  // The fix_env override only applies to failures inside an affected suite.
  // 5xx (api_error) is excluded everywhere — backend bugs stay
  // report_backend_bug regardless of env state.
  let env_issue: EnvIssue | undefined;
  const legacyEnvHint = computeSharedEnvIssue(failures, envFilePath);
  const clusters = clusterEnvIssues(failures);
  const built = buildEnvIssue(clusters, envFilePath);

  let affectedSuites: Set<string>;
  if (built) {
    env_issue = built;
    affectedSuites = new Set(built.affected_suites);
  } else if (legacyEnvHint) {
    // Legacy global env_issue (no clustered match — e.g. only one failure,
    // or every suite has a single failing test). Preserve the original
    // single-message form but expose it via the new envelope shape so
    // downstream consumers see one stable contract.
    const allSuites = [...new Set(failures.filter(f => f.failure_type !== "api_error").map(f => f.suite_name))].sort();
    env_issue = {
      message: legacyEnvHint,
      scope: "run",
      affected_suites: allSuites,
      symptoms: {},
    };
    affectedSuites = new Set(allSuites);
  } else {
    affectedSuites = new Set();
  }

  if (env_issue) {
    for (const f of failures) {
      if (f.failure_type === "api_error") continue; // real backend bug — keep
      if (!affectedSuites.has(f.suite_name)) continue; // out-of-scope suite
      f.recommended_action = "fix_env";
      delete f.hint;
      delete f.schema_hint;
    }
  }

  let apiErrors = 0, assertionFailures = 0, networkErrors = 0;
  let authFailureCount = 0;
  for (const f of failures) {
    if (f.failure_type === "api_error") apiErrors++;
    else if (f.failure_type === "assertion_failed") assertionFailures++;
    else if (f.failure_type === "network_error") networkErrors++;
    if (f.response_status === 401 || f.response_status === 403) authFailureCount++;
  }

  let agent_directive: string | undefined;
  if (apiErrors > 0) {
    const fixable = assertionFailures + networkErrors;
    agent_directive =
      `${apiErrors} test${apiErrors === 1 ? "" : "s"} returned 5xx server errors. ` +
      `Do NOT change test expectations to accept 5xx responses. ` +
      `These are backend bugs, not test logic errors. ` +
      `Stop iterating on these tests and report the failures to the API team.` +
      (fixable > 0
        ? ` The remaining ${fixable} failure${fixable === 1 ? "" : "s"} may be fixable in test logic.`
        : "");
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

  // Auth hint: when many tests fail with 401/403, suggest auth setup
  let auth_hint: string | undefined;
  if (authFailureCount >= 5 && authFailureCount / diagRun.total >= 0.3) {
    const loginEndpoint = allResults.find(
      r => r.request_method?.toUpperCase() === "POST" && AUTH_PATH_RE.test(r.request_url ?? "")
    );
    if (loginEndpoint) {
      auth_hint = `${authFailureCount} tests failed with 401/403. Found auth endpoint: POST ${loginEndpoint.request_url} — add \`setup: true\` to your auth suite so its captured token is shared with all other suites, or set auth_token manually in .env.yaml`;
    } else {
      auth_hint = `${authFailureCount} tests failed with 401/403 — add \`setup: true\` to your auth suite so its captured token is shared with all other suites, or set auth_token in .env.yaml`;
    }
  }

  const { grouped_failures, compactFailures } = verbose
    ? { grouped_failures: undefined, compactFailures: failures }
    : groupFailures(failures, maxExamples);

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
    ...(agent_directive ? { agent_directive } : {}),
    ...(env_issue ? { env_issue } : {}),
    ...(auth_hint ? { auth_hint } : {}),
    ...(cascade_skips ? { cascade_skips } : {}),
    failures: compactFailures,
    ...(grouped_failures ? { grouped_failures } : {}),
  };
}

type FailureItem = { suite_name: string; test_name: string; failure_type: string; recommended_action: RecommendedAction; hint?: string; response_status: number | null };

/** Group similar failures for compact output. Exported for testing. */
export function groupFailures<T extends FailureItem>(failures: T[], maxExamples = 2): { grouped_failures?: FailureGroup[]; compactFailures: T[] } {
  if (failures.length <= 5) {
    return { compactFailures: failures };
  }

  const groupMap = new Map<string, { items: T[]; failure_type: string; hint?: string; response_status: number | null }>();

  for (const f of failures) {
    const key = `${f.response_status ?? "null"}|${f.failure_type}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.items.push(f);
    } else {
      groupMap.set(key, {
        items: [f],
        failure_type: f.failure_type,
        hint: f.hint,
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
      hint: group.hint,
      examples: (showAll ? group.items : group.items.slice(0, maxExamples)).map(f => `${f.suite_name}/${f.test_name}`),
      response_status: group.response_status,
    });
    if (isApiError) {
      compactFailures.push(...group.items);
    } else {
      compactFailures.push(group.items[0]!);
    }
  }

  return { grouped_failures, compactFailures };
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
  };
  regressions: Array<{ suite: string; test: string; before: string; after: string }>;
  fixes: Array<{ suite: string; test: string; before: string; after: string }>;
  hasRegressions: boolean;
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
  for (const r of resultsA) mapA.set(`${r.suite_name}::${r.test_name}`, r.status);
  for (const r of resultsB) mapB.set(`${r.suite_name}::${r.test_name}`, r.status);

  const regressions: Array<{ suite: string; test: string; before: string; after: string }> = [];
  const fixes: Array<{ suite: string; test: string; before: string; after: string }> = [];
  let unchanged = 0;
  let newTests = 0;
  let removedTests = 0;

  for (const [key, statusB] of mapB) {
    const statusA = mapA.get(key);
    if (statusA === undefined) { newTests++; continue; }
    const [suite, test] = key.split("::") as [string, string];
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
    summary: { regressions: regressions.length, fixes: fixes.length, unchanged, newTests, removedTests },
    regressions,
    fixes,
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
