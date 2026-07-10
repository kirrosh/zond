import { readOpenApiSpec, extractEndpoints, analyzeEndpoints } from "../../core/generator/index.ts";
import { getDb } from "../../db/schema.ts";
import { loadCoverage } from "../../core/coverage/loader.ts";
import type { CoverageMatrix, MatrixRow } from "../../core/coverage/reasons.ts";
import { printError } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface CoverageOptions {
  apiName?: string;
  spec?: string;
  failOnCoverage?: number;
  runId?: number;
  /** TASK-255: union across multiple runs. */
  runIds?: number[];
  /** TASK-255: union across all runs in a session (filtered to the API). */
  sessionId?: string;
  /** TASK-274: union across all runs of the API started after this ISO ts. */
  sinceIso?: string;
  /** TASK-274: union across all runs of the API tagged <tag>. */
  tag?: string;
  json?: boolean;
  /** ARV-28: list not-covered (and partial) endpoints inline so users
   *  don't need `--json | jq` to see what's missing. */
  verbose?: boolean;
  /** ARV-265: which metric block(s) to render.
   *   - 'test' — pass/hit coverage only (legacy single-block output)
   *   - 'audit' — audit-coverage only (every HTTP touch, with source
   *     breakdown). Useful when only `zond checks run` happened.
   *   - 'both' (default) — both blocks side-by-side. */
  scope?: "test" | "audit" | "both";
}

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function useColor(): boolean {
  return process.stdout.isTTY ?? false;
}

interface CoverageBreakdown {
  coveredRows: MatrixRow[];
  partialRows: MatrixRow[];
  uncoveredRows: MatrixRow[];
}

function classifyRows(matrix: CoverageMatrix): CoverageBreakdown {
  const coveredRows: MatrixRow[] = [];
  const partialRows: MatrixRow[] = [];
  const uncoveredRows: MatrixRow[] = [];
  for (const row of matrix.rows) {
    const cells = Object.values(row.cells);
    if (cells.some((c) => c.status === "covered")) coveredRows.push(row);
    else if (cells.some((c) => c.status === "partial")) partialRows.push(row);
    else uncoveredRows.push(row);
  }
  return { coveredRows, partialRows, uncoveredRows };
}

/**
 * TASK-280: row-level pass/fail classification used by both the text and JSON
 * outputs so they share a single source of truth.
 *
 *   covered2xx        — at least one stored result on this endpoint was a
 *                       passing 2xx (matches `✅ N covered (passing 2xx)`)
 *   coveredButNon2xx  — endpoint was hit but never produced a 2xx pass
 *                       (5xx, 4xx, assertion failure — anything that landed
 *                        a response or generated an `error`)
 *   unhit             — no stored results at all on this endpoint
 */
export interface RowBucket {
  endpoint: string;
  method: string;
  path: string;
  /** Latest observed HTTP status across all cells/results on this row, or
   *  `null` for unhit / network-error-only rows. Chronological-last — on a row
   *  that ran both a positive and a negative case this is often the negative
   *  (4xx) one, so DON'T read it as "is this endpoint healthy": use passStatus. */
  lastStatus: number | null;
  /** ARV-426: the 2xx status that earned covered2xx membership (the request
   *  that actually passed), or `null` when no 2xx pass exists on this row. This
   *  is the honest per-endpoint health signal that the warm-up flow relies on —
   *  lastStatus alone contradicted bucket membership ~82% of the time. */
  passStatus: number | null;
  /** ARV-379: spec-declared `deprecated` (or text-flagged) for this
   *  endpoint. Lets a consumer split "real, closeable gap" from
   *  "structurally out of scope by design" without re-reading spec.json. */
  deprecated: boolean;
}

export interface BucketBreakdown {
  covered2xx: RowBucket[];
  coveredButNon2xx: RowBucket[];
  unhit: RowBucket[];
}

export function bucketRows(matrix: CoverageMatrix): BucketBreakdown {
  const covered2xx: RowBucket[] = [];
  const coveredButNon2xx: RowBucket[] = [];
  const unhit: RowBucket[] = [];
  for (const row of matrix.rows) {
    const cells = Object.values(row.cells);
    const allResults = cells.flatMap(c => c.results);
    const passResult = allResults.find(
      r => r.status === "pass" && r.responseStatus != null && r.responseStatus >= 200 && r.responseStatus < 300,
    );
    const has2xxPass = passResult !== undefined;
    const lastStatus = lastObservedStatus(allResults);
    const bucket: RowBucket = {
      endpoint: row.endpoint,
      method: row.method,
      path: row.path,
      lastStatus,
      passStatus: passResult?.responseStatus ?? null,
      deprecated: !!row.deprecated,
    };
    if (has2xxPass) covered2xx.push(bucket);
    else if (allResults.length > 0) coveredButNon2xx.push(bucket);
    else unhit.push(bucket);
  }
  return { covered2xx, coveredButNon2xx, unhit };
}

/**
 * ARV-265: roll up the audit-coverage matrix per producer (`run_kind`).
 * `reached` counts how many spec endpoints have at least one result row
 * across any kind; `totalEvents` is the raw result count (one per HTTP
 * touch). `bySource` keys are the run_kind values that actually appear
 * in `cov.runs` — kinds with zero contribution are omitted from the
 * map so the text reporter doesn't print empty rows.
 *
 * Endpoint attribution uses the same matrix engine output the loader
 * already built (each `MatrixRow` cell carries the results that mapped
 * to that endpoint), but the engine doesn't track which run produced
 * each result. We re-walk the contributing runs and re-load their
 * results to bucket by kind. For the 1184-endpoint github-spec scan
 * this is O(N) over ~1500 result rows — negligible vs the run cost.
 */
function computeAuditBreakdown(cov: import("../../core/coverage/loader.ts").CoverageLoadResult): {
  reached: number;
  total: number;
  percentage: number;
  totalEvents: number;
  bySource: Record<string, { endpoints: number; events: number }>;
} {
  const total = cov.matrix.rows.length;
  // reached: endpoints with any result (cells with at least one entry).
  let reached = 0;
  for (const row of cov.matrix.rows) {
    const cells = Object.values(row.cells);
    if (cells.some((c) => c.results.length > 0)) reached += 1;
  }
  const totalEvents = cov.matrix.rows.reduce(
    (sum, row) => sum + Object.values(row.cells).reduce((s, c) => s + c.results.length, 0),
    0,
  );
  // Re-load per-run results to attribute counts to the producing kind.
  const bySource: Record<string, { endpoints: Set<string>; events: number }> = {};
  for (const run of cov.runs) {
    const kind = run.run_kind;
    const bucket = bySource[kind] ?? { endpoints: new Set<string>(), events: 0 };
    const rows = getResultsByRunId(run.id);
    for (const r of rows) {
      // Skip pre-dispatch skips (max-requests cap, schema-gated) — they have
      // no response and don't represent an actual HTTP touch.
      if (r.response_status == null) continue;
      bucket.events += 1;
      if (typeof r.request_method === "string" && typeof r.request_url === "string") {
        // The result table stores absolute URLs; the matrix engine uses
        // the spec path-template regex to bucket them. For the by-source
        // count we don't need that level of precision — pathname-only is
        // close enough for "did this kind touch endpoint X" telemetry.
        try {
          const u = new URL(r.request_url);
          bucket.endpoints.add(`${r.request_method.toUpperCase()} ${u.pathname}`);
        } catch {
          bucket.endpoints.add(`${r.request_method.toUpperCase()} ${r.request_url}`);
        }
      }
    }
    bySource[kind] = bucket;
  }
  const flatBySource: Record<string, { endpoints: number; events: number }> = {};
  for (const [k, v] of Object.entries(bySource)) {
    flatBySource[k] = { endpoints: v.endpoints.size, events: v.events };
  }
  return {
    reached,
    total,
    percentage: total === 0 ? 0 : Math.round((reached / total) * 100),
    totalEvents,
    bySource: flatBySource,
  };
}

function lastObservedStatus(results: { responseStatus: number | null }[]): number | null {
  for (let i = results.length - 1; i >= 0; i--) {
    const s = results[i]?.responseStatus;
    if (typeof s === "number") return s;
  }
  return null;
}

export async function coverageCommand(options: CoverageOptions): Promise<number> {
  try {
    if (options.apiName) {
      return await runMatrixCoverage(options);
    }
    return await runSpecOnlyCoverage(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("coverage", [message]));
    else printError(message);
    return 2;
  }
}

/**
 * Matrix-based path: an endpoint is "covered" iff some result on it landed
 * a 2xx pass. Driven by the latest stored run (or `--runId`). This is the
 * answer to "did we actually exercise the endpoint", which is what
 * `--fail-on-coverage` gates in CI.
 */
async function runMatrixCoverage(options: CoverageOptions): Promise<number> {
  getDb();
  const scope = options.scope ?? "both";
  const wantTest = scope === "test" || scope === "both";
  const wantAudit = scope === "audit" || scope === "both";

  const loaderArgs = {
    apiName: options.apiName!,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.sinceIso ? { sinceIso: options.sinceIso } : {}),
    ...(options.tag ? { tag: options.tag } : {}),
    ...(options.runIds && options.runIds.length > 0 ? { runIds: options.runIds } : {}),
    ...(options.runId != null ? { runId: options.runId } : {}),
  } as const;

  // ARV-265: load the matrix twice when scope=both — once for the
  // pass/hit "did our suites land 2xx" metric (`scope: 'test'`), and once
  // for the "did zond touch the endpoint at all" audit metric
  // (`scope: 'audit'`). Loader-level scoping keeps the matrix shape
  // identical so both branches reuse classifyRows / bucketRows.
  const covTest = wantTest ? await loadCoverage({ ...loaderArgs, scope: "test" }) : null;
  const covAudit = wantAudit ? await loadCoverage({ ...loaderArgs, scope: "audit" }) : null;
  // Pick whichever block is present as the canonical "cov" — we still
  // need a matrix to enumerate endpoints + spec warnings.
  const cov = covTest ?? covAudit!;
  const total = cov.matrix.rows.length;
  if (total === 0) {
    printError("No endpoints found in the OpenAPI spec");
    return 1;
  }

  const { coveredRows, partialRows, uncoveredRows } = classifyRows((covTest ?? covAudit!).matrix);
  const coveredCount = coveredRows.length;
  const percentage = Math.round((coveredCount / total) * 100);

  // ARV-303: envelope/exit-code contract. When the selector resolved to zero
  // runs (closed session, --session-id with no runs, --union tag with no
  // matches), there is no coverage data — that is the only command-level
  // failure of the matrix path. Everything else (uncovered endpoints remain)
  // is a data point, not a failure, so it must not gate the exit code.
  // ARV-409: coverage is computable if ANY loaded scope has runs. A checks-only
  // session (run_kind='check', stripped from test scope) leaves covTest empty
  // but covAudit full — abort only when both are dry, else audit_coverage still
  // reports the HTTP touches (ARV-265) instead of falsely claiming zero runs.
  const noRuns = (covTest?.runs.length ?? 0) === 0 && (covAudit?.runs.length ?? 0) === 0;

  // ARV-265: per-source breakdown for audit-coverage. Walks each
  // contributing run, groups its results by (METHOD, path-template), and
  // tallies distinct endpoints reached + raw event counts. The match is
  // best-effort (uses the same endpoint regex the matrix engine does) so
  // a run that hit URLs not declared in the spec is still counted by
  // event-count even when no endpoint maps.
  const auditBreakdown = covAudit ? computeAuditBreakdown(covAudit) : null;

  // TASK-270: two metrics, two intents:
  //   pass_coverage = endpoints with at least one passing 2xx (strict — what
  //                   single-run output has always meant)
  //   hit_coverage  = endpoints we touched at all (loose — what `--union`
  //                   used to silently mean)
  // Show both so the reader doesn't have to re-derive the difference.
  const passCount = coveredRows.length;
  const hitCount = coveredRows.length + partialRows.length;
  const passPct = Math.round((passCount / total) * 100);
  const hitPct = Math.round((hitCount / total) * 100);

  let passing = 0;
  let apiError = 0;
  let testFailed = 0;
  for (const row of [...coveredRows, ...partialRows]) {
    const cells = Object.values(row.cells);
    const has5xx = cells.some((c) =>
      c.results.some((r) => r.responseStatus != null && r.responseStatus >= 500),
    );
    const has2xxPass = cells.some((c) =>
      c.results.some((r) => r.status === "pass" && r.responseStatus != null && r.responseStatus >= 200 && r.responseStatus < 300),
    );
    const hasFail = cells.some((c) => c.results.some((r) => r.status !== "pass"));
    if (has5xx) apiError++;
    else if (has2xxPass) passing++;
    else if (hasFail) testFailed++;
  }

  if (!options.json) {
    const color = useColor();
    const runsForLabel = covTest ?? covAudit!;
    let runLabel: string;
    if (runsForLabel.runs.length === 0) {
      runLabel = runsForLabel.unionMode
        ? ` — no runs match --union ${runsForLabel.unionMode}`
        : " — no runs yet";
    }
    else if (runsForLabel.runs.length === 1) runLabel = ` — Run #${runsForLabel.runs[0]!.id}`;
    else {
      const modeLabel = runsForLabel.unionMode ? ` ${runsForLabel.unionMode}` : "";
      runLabel = ` — union${modeLabel} of ${runsForLabel.runs.length} runs (#${runsForLabel.runs.map(r => r.id).join(", #")})`;
    }
    if (wantTest) {
      // TASK-270: show both metrics on separate lines so CI/triage scripts
      // and humans can pick the one they care about.
      console.log(`test-coverage`);
      console.log(`  Pass-coverage (passing 2xx): ${passCount}/${total} endpoints (${passPct}%)${runLabel}`);
      console.log(`  Hit-coverage  (any response): ${hitCount}/${total} endpoints (${hitPct}%)`);
      // ARV-265: clarified source line. Previously: "only zond run results — probes not counted".
      // After ARV-265, audit-coverage IS the answer for "did checks run touch X" — point users at it.
      console.log(`  ${color ? DIM : ""}(source: \`zond run\` results — for \`checks run\` / \`probe\` touches see audit-coverage below)${color ? RESET : ""}`);
      console.log("");

      if (passing > 0) {
        console.log(`  ${color ? GREEN : ""}✅ ${passing} covered (passing 2xx)${color ? RESET : ""}`);
      }
      if (apiError > 0) {
        console.log(`  ${color ? YELLOW : ""}⚠️  ${apiError} returning 5xx (possibly broken API)${color ? RESET : ""}`);
      }
      if (testFailed > 0) {
        console.log(`  ${color ? RED : ""}❌ ${testFailed} hit endpoint but assertions failed${color ? RESET : ""}`);
      }
      if (partialRows.length > 0 && testFailed === 0) {
        console.log(`  ${color ? YELLOW : ""}◐ ${partialRows.length} partial (only non-2xx responses)${color ? RESET : ""}`);
      }
      if (uncoveredRows.length > 0) {
        console.log(`  ${color ? DIM : ""}⬜ ${uncoveredRows.length} not covered${color ? RESET : ""}`);
        // ARV-75 (feedback round-03 / F16): when some of the not-covered rows
        // are deprecated, surface the count so a user reading "5% uncovered"
        // can attribute the gap to deprecated endpoints (which generate skips
        // by default) instead of suite regression.
        const deprecatedUnhit = uncoveredRows.filter((r) => r.deprecated).length;
        if (deprecatedUnhit > 0) {
          console.log(`  ${color ? DIM : ""}↳ ${deprecatedUnhit} of those are deprecated (skipped by \`zond generate\` unless --include-deprecated)${color ? RESET : ""}`);
        }
      }
    }

    if (wantAudit && auditBreakdown) {
      if (wantTest) console.log("");
      console.log(`audit-coverage: ${auditBreakdown.reached}/${auditBreakdown.total} endpoints (${auditBreakdown.percentage}%, ${auditBreakdown.totalEvents} HTTP touches)`);
      console.log(`  ${color ? DIM : ""}(any zond producer: run, checks, probe, request, fixture-cascade — ARV-265)${color ? RESET : ""}`);
      const sources = Object.entries(auditBreakdown.bySource).filter(([, v]) => v.events > 0);
      if (sources.length > 0) {
        console.log(`  by source:`);
        for (const [kind, v] of sources) {
          console.log(`    ${kind.padEnd(8)} ${String(v.endpoints).padStart(4)} endpoints, ${String(v.events).padStart(5)} events`);
        }
      }
    }

    // ARV-28: --verbose lists not-covered endpoints (and partial) inline,
    // so users don't have to pipe through `--json | jq` for that detail.
    if (options.verbose && (uncoveredRows.length > 0 || partialRows.length > 0)) {
      if (partialRows.length > 0) {
        console.log("");
        console.log(`${color ? YELLOW : ""}Partial (only non-2xx responses):${color ? RESET : ""}`);
        for (const row of partialRows) console.log(`  ◐ ${row.endpoint}`);
      }
      if (uncoveredRows.length > 0) {
        console.log("");
        console.log(`${color ? DIM : ""}Not covered:${color ? RESET : ""}`);
        for (const row of uncoveredRows) console.log(`  ⬜ ${row.endpoint}`);
      }
    }

    if (cov.matrix.totals.byReason["no-fixtures"] > 0 || cov.matrix.totals.byReason["auth-scope-mismatch"] > 0) {
      console.log("");
      if (cov.matrix.totals.byReason["no-fixtures"] > 0) {
        // TASK-41: clarify what "blocked by no-fixtures" means — these are
        // endpoints whose smoke/CRUD suite is *generated* but `skip_if`-gated
        // on an empty path-param fixture. The fix is a one-shot env edit, not
        // suite regeneration. Point users at the actual remedy.
        console.log(
          `  ${color ? DIM : ""}↳ ${cov.matrix.totals.byReason["no-fixtures"]} ` +
          `cells blocked by no-fixtures (suite generated, awaiting IDs in .env.yaml — ` +
          `run \`zond prepare-fixtures --api ${cov.apiName}\` or seed manually).${color ? RESET : ""}`,
        );
      }
      if (cov.matrix.totals.byReason["auth-scope-mismatch"] > 0) {
        console.log(`  ${color ? DIM : ""}↳ ${cov.matrix.totals.byReason["auth-scope-mismatch"]} cells blocked by auth-scope-mismatch${color ? RESET : ""}`);
      }
    }
  } else {
    // TASK-280: emit explicit covered2xx / coveredButNon2xx / unhit buckets
    // so JSON consumers see the same breakdown as the text reporter. Legacy
    // fields (covered/uncovered/partial, coveredEndpoints/partialEndpoints/
    // uncoveredEndpoints) are kept as deprecated aliases pending full envelope-
    // policy unification (TASK-184).
    const buckets = bucketRows((covTest ?? covAudit!).matrix);
    // ARV-265: dual-metric JSON envelope. `test_coverage` mirrors the
    // pre-ARV-265 single-block shape (kept as the canonical
    // pass/hit pair); `audit_coverage` is additive and only present
    // when scope includes audit. Legacy top-level fields stay populated
    // from the test block when present (back-compat with TASK-280
    // consumers) so existing CI scripts don't break.
    const json: Record<string, unknown> = {
      // Legacy aliases — DO NOT add new consumers; use `totals.*` and
      // `*Endpoints` arrays below instead.
      covered: coveredCount,
      uncovered: uncoveredRows.length,
      partial: partialRows.length,
      total,
      percentage,
      runId: cov.run?.id ?? null,
      runIds: cov.runs.map((r) => r.id),
      union_mode: cov.unionMode,
      coveredEndpoints: coveredRows.map((r) => r.endpoint),
      partialEndpoints: partialRows.map((r) => r.endpoint),
      uncoveredEndpoints: uncoveredRows.map((r) => r.endpoint),
      // Canonical buckets (TASK-280).
      totals: {
        all: total,
        covered2xx: buckets.covered2xx.length,
        coveredButNon2xx: buckets.coveredButNon2xx.length,
        unhit: buckets.unhit.length,
      },
      // TASK-270: explicit twin metrics — pass_coverage is the strict
      // "does the test land a 2xx", hit_coverage is the loose "did we
      // touch the endpoint at all". Both expressed as endpoint-count and
      // 0..1 ratio so CI scripts don't re-derive them from the buckets.
      pass_coverage: { covered: passCount, total, ratio: total === 0 ? 0 : Number((passCount / total).toFixed(4)) },
      hit_coverage:  { covered: hitCount,  total, ratio: total === 0 ? 0 : Number((hitCount / total).toFixed(4)) },
      covered2xxEndpoints: buckets.covered2xx,
      coveredButNon2xxEndpoints: buckets.coveredButNon2xx,
      unhitEndpoints: buckets.unhit,
      // ARV-75 (F16): expose deprecated-endpoint counts so CI / agents can
      // distinguish "we missed coverage on a live endpoint" from "the
      // remaining uncovered rows are spec-deprecated and explicitly skipped
      // by zond generate" without re-deriving from the spec.
      deprecated_unhit: uncoveredRows.filter((r) => r.deprecated).length,
      deprecated_total: cov.matrix.rows.filter((r) => r.deprecated).length,
      // ARV-379: the endpoint keys (method+path) marked deprecated in the
      // spec. Intersect with `uncoveredEndpoints` to split "real, closeable
      // gap" from "deprecated, skip by design" without re-reading spec.json.
      // (RowBucket entries in the *Endpoints arrays also carry a per-entry
      //  `deprecated` boolean for the object-shaped consumers.)
      deprecatedEndpoints: cov.matrix.rows.filter((r) => r.deprecated).map((r) => r.endpoint),
      // ARV-265: dual-metric envelope.
      test_coverage: wantTest ? {
        pass: { covered: passCount, total, ratio: total === 0 ? 0 : Number((passCount / total).toFixed(4)) },
        hit:  { covered: hitCount,  total, ratio: total === 0 ? 0 : Number((hitCount / total).toFixed(4)) },
        runIds: covTest?.runs.map((r) => r.id) ?? [],
      } : null,
    };
    if (auditBreakdown) {
      json.audit_coverage = {
        reached: auditBreakdown.reached,
        total: auditBreakdown.total,
        ratio: auditBreakdown.total === 0 ? 0 : Number((auditBreakdown.reached / auditBreakdown.total).toFixed(4)),
        events: auditBreakdown.totalEvents,
        by_source: auditBreakdown.bySource,
        runIds: covAudit?.runs.map((r) => r.id) ?? [],
      };
    }
    // ARV-303: surface the zero-runs case as ok:false so the non-zero exit
    // lines up with the envelope shape, instead of an ok:true envelope
    // alongside exit 1.
    if (noRuns) {
      const sel = cov.unionMode ?? "selection";
      printJson(jsonError("coverage", [
        `No runs match ${sel} — coverage cannot be computed against zero runs`,
      ]));
    } else {
      printJson(jsonOk("coverage", json));
    }
  }

  // ARV-303: exit-code contract. ok:false (no runs) ⇒ exit 1. Otherwise the
  // coverage was computed successfully (ok:true) ⇒ exit 0 by default — an
  // orchestrator must be able to tell "coverage ran" from "command failed".
  // "Uncovered endpoints remain" no longer gates the exit on its own; use
  // --fail-on-coverage to opt into a threshold gate.
  if (noRuns) return 1;
  if (options.failOnCoverage !== undefined) {
    return percentage < options.failOnCoverage ? 1 : 0;
  }
  return 0;
}

/**
 * Legacy fallback: when neither `--api` nor a current API is set, report
 * spec-only stats. Without a registered collection there is no run to read,
 * so no endpoint is callable-covered — surface that explicitly instead of
 * silently scanning YAML and over-reporting.
 */
async function runSpecOnlyCoverage(options: CoverageOptions): Promise<number> {
  if (!options.spec) {
    const msg = "Need --api <name> (preferred) or --spec <path>. Coverage is computed against stored run results.";
    if (options.json) printJson(jsonError("coverage", [msg]));
    else printError(msg);
    return 2;
  }
  const doc = await readOpenApiSpec(options.spec);
  const allEndpoints = extractEndpoints(doc);
  if (allEndpoints.length === 0) {
    printError("No endpoints found in the OpenAPI spec");
    return 1;
  }
  const total = allEndpoints.length;
  const percentage = 0;

  if (!options.json) {
    const color = useColor();
    console.log(`Coverage: 0/${total} endpoints (0%) — no API registered`);
    console.log("");
    console.log(`  ${color ? DIM : ""}Register the spec with \`zond add api --spec <path>\` to track run results.${color ? RESET : ""}`);
    const warnings = analyzeEndpoints(allEndpoints);
    if (warnings.length > 0) {
      console.log("");
      console.log(`${color ? YELLOW : ""}Spec warnings:${color ? RESET : ""}`);
      for (const w of warnings) {
        console.log(`  ${color ? YELLOW : ""}⚠${color ? RESET : ""} ${w.method.padEnd(7)} ${w.path}: ${w.warnings.join(", ")}`);
      }
    }
  } else {
    // TASK-250 + ARV-303: the spec-only path emits a shape-stable
    // ok:true envelope even when there's no registered API. The
    // legacy contract here is "we parsed the spec, here is 0% with a
    // null runId" — agents and CI scripts depend on the key shape.
    // ARV-303 only tightens the matrix-coverage path (no runs match
    // --union / --session-id), which DID emit ok:true alongside exit
    // 1; the spec-only path was intentionally informational.
    const unhit = allEndpoints.map((ep) => ({
      endpoint: `${ep.method.toUpperCase()} ${ep.path}`,
      method: ep.method.toUpperCase(),
      path: ep.path,
      lastStatus: null,
      passStatus: null,
    }));
    printJson(jsonOk("coverage", {
      covered: 0,
      uncovered: total,
      partial: 0,
      total,
      percentage,
      runId: null,
      coveredEndpoints: [],
      partialEndpoints: [],
      uncoveredEndpoints: unhit.map(u => u.endpoint),
      totals: { all: total, covered2xx: 0, coveredButNon2xx: 0, unhit: total },
      covered2xxEndpoints: [],
      coveredButNon2xxEndpoints: [],
      unhitEndpoints: unhit,
      pass_coverage: { covered: 0, total, ratio: 0 },
      hit_coverage: { covered: 0, total, ratio: 0 },
    }));
  }

  if (options.failOnCoverage !== undefined) {
    return percentage < options.failOnCoverage ? 1 : 0;
  }
  return 1;
}

import type { Command } from "commander";
import { Option } from "commander";
import { globalJson, resolveApiCollection } from "../resolve.ts";
import { parseInteger, parsePercentage } from "../argv.ts";
import { getApi } from "../util/api-context.ts";
import { readCurrentSession } from "../../core/context/session.ts";
import { listRunsBySession, getLatestRunByCollection, getRunById, findCollectionByNameOrId, listSessions, getResultsByRunId } from "../../db/queries.ts";

/**
 * ARV-55: probe-run classification moved from path-regex heuristic into the
 * persisted `runs.run_kind` column. Coverage's default loader query already
 * filters `run_kind = 'regular'`, so this helper is no longer the gate — it
 * just powers the human-readable warning when the *latest* run (regardless
 * of kind) happens to be a probe-only one, which still surprises users.
 */
export function isProbeOnlyRun(runId: number): boolean {
  const run = getRunById(runId);
  return run?.run_kind === "probe";
}

export type UnionSpec =
  | { kind: "session" }
  | { kind: "since"; durationMs: number; raw: string }
  | { kind: "tag"; name: string }
  | { kind: "runIds"; ids: number[] };

const DURATION_RE = /^(\d+)\s*(s|m|h|d)$/i;
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** TASK-274: parse a duration like `30m`, `2h`, `7d`. Throws on bad input. */
export function parseDuration(value: string): number {
  const m = value.trim().match(DURATION_RE);
  if (!m) {
    throw new Error(
      `Invalid duration '${value}' — expected '<N><unit>' where unit is s/m/h/d (e.g. '30m', '24h', '7d').`,
    );
  }
  const n = Number(m[1]!);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid duration '${value}' — must be a positive integer.`);
  }
  return n * UNIT_MS[m[2]!.toLowerCase()]!;
}

/** TASK-255 + TASK-274: parse `--union <selector>`. Supported forms:
 *    - `session`                     — all runs in the active/specified session
 *    - `since:<dur>` (e.g. `since:24h`)— runs of this collection started after now-dur
 *    - `tag:<name>`                  — runs of this collection whose stored tags include <name>
 *    - `runs:A,B,C` or bare `A,B,C`  — explicit list of run IDs (back-compat)
 *  Exported for unit tests. */
export function parseUnion(value: string): UnionSpec {
  const v = value.trim();
  if (v.length === 0) {
    throw new Error(
      "--union expects 'session', 'since:<dur>', 'tag:<name>', or 'runs:<id1,id2,…>' (also accepts a bare comma-separated id list).",
    );
  }
  const lower = v.toLowerCase();
  if (lower === "session") return { kind: "session" };

  if (lower.startsWith("since:")) {
    const raw = v.slice("since:".length).trim();
    if (!raw) throw new Error("--union since:<dur> needs a duration (e.g. 'since:24h').");
    return { kind: "since", durationMs: parseDuration(raw), raw };
  }

  if (lower.startsWith("tag:")) {
    const name = v.slice("tag:".length).trim();
    if (!name) throw new Error("--union tag:<name> needs a tag (e.g. 'tag:smoke').");
    return { kind: "tag", name };
  }

  // `runs:` prefix is the documented form; bare comma list kept for
  // back-compat with the original TASK-255 surface (`--union 58,59`).
  const idsRaw = lower.startsWith("runs:") ? v.slice("runs:".length) : v;
  const ids = idsRaw.split(",").map((s) => s.trim()).filter((s) => s.length > 0).map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `--union expects 'session', 'since:<dur>', 'tag:<name>', or 'runs:<id1,id2,…>' — got '${value}'.`,
      );
    }
    return n;
  });
  if (ids.length === 0) {
    throw new Error(
      "--union expects 'session', 'since:<dur>', 'tag:<name>', or 'runs:<id1,id2,…>'.",
    );
  }
  return { kind: "runIds", ids };
}

export function registerCoverage(program: Command): void {
  program
    .command("coverage")
    .description(
      "Analyze API test coverage from stored run results. zond reports two " +
      "metric blocks side-by-side (ARV-265):\n" +
      "  test-coverage  — pass/hit from `zond run` (regular + probe runs only)\n" +
      "    · pass-coverage — endpoint had at least one passing 2xx (strict; CI gate via --fail-on-coverage)\n" +
      "    · hit-coverage  — endpoint received any response, incl. 5xx / assertion-fail (loose; breadth)\n" +
      "  audit-coverage — any HTTP touch from any producer: `run`, `checks run`,\n" +
      "    `probe`, `request`, `prepare-fixtures --cascade`. With by-source breakdown.\n" +
      "\n" +
      "Use --scope to print just one block: `--scope test` for legacy single-metric\n" +
      "output, `--scope audit` to answer 'did the scan reach the API at all'.\n" +
      "Producers opt out via ZOND_CHECKS_PERSIST=0 (default: persist on).\n" +
      "\n" +
      "Defaults to the latest stored run for the resolved API; pass " +
      "--run-id to pin a specific run, or --union <selector> to combine " +
      "multiple runs.\n" +
      "\n" +
      "--union selectors:\n" +
      "  session                   Active session (or --session-id <id>) — every run in the\n" +
      "                            session is folded in; use this for the\n" +
      "                            tests-run + probes-run pattern from one\n" +
      "                            `zond session start` block.\n" +
      "  since:<dur>               Time-window across the API (1h, 24h, 7d, 30m). Folds\n" +
      "                            every run started within the window — handy for CI\n" +
      "                            'last-day coverage' aggregates spanning multiple sessions.\n" +
      "  tag:<name>                Every run whose stored tags include <name>. Tags come\n" +
      "                            from suite-level `tags:` plus any explicit `--tag <x>`\n" +
      "                            on `zond run`. Useful for slicing by class\n" +
      "                            (e.g. `tag:smoke`, `tag:negative`).\n" +
      "  runs:<id1,id2,...>        Explicit list of run IDs (e.g. release-vs-release).\n" +
      "                            A bare `<id1,id2,...>` is also accepted for back-compat.\n" +
      "\n" +
      "Recipe (session form):\n" +
      "  zond session start --label combined\n" +
      "  zond run apis/<api>/tests\n" +
      "  zond run apis/<api>/probes\n" +
      "  zond coverage --api <api> --union session\n" +
      "\n" +
      "Exit codes (ARV-303): 0 = coverage computed successfully (envelope " +
      "ok:true — uncovered endpoints remaining is a data point, not a " +
      "failure); 1 = coverage could not be computed (selector resolved to " +
      "zero runs) or pass-coverage < --fail-on-coverage; 2 = bad input or " +
      "read error. Uncovered endpoints only gate the exit when you opt in " +
      "with --fail-on-coverage; that flag gates pass-coverage, not hit-coverage.",
    )
    .option("--api <name>", "Use API collection (auto-resolves spec; reads stored runs)")
    .option("--spec <path>", "Spec-only fallback when no API is registered (no run results)")
    .option("--fail-on-coverage <N>", "Exit 1 when coverage percentage is below N (0–100)", parsePercentage)
    .option("--run-id <number>", "Pin to a specific run instead of the latest", parseInteger("--run-id"))
    .option("--session-id <id>", "Union all runs in this session (filtered to the chosen API)")
    .option(
      "--union <selector>",
      "Combine multiple runs. Selector: 'session', 'since:<dur>' (e.g. since:24h), 'tag:<name>', or 'runs:<id1,id2,…>' (bare comma-list also accepted)",
    )
    .option("--db <path>", "Path to SQLite database file")
    .option("--verbose", "List not-covered (and partial) endpoints inline — same data as `--json` but human-readable")
    .addOption(
      new Option(
        "--scope <scope>",
        "ARV-265: which coverage block(s) to print. `test` = pass-coverage/hit-coverage only (legacy single block from `zond run` results). `audit` = audit-coverage only (every HTTP touch from `run` / `checks run` / `probe` / `request` / fixture-cascade, with by-source breakdown). `both` (default) = both side-by-side.",
      ).choices(["test", "audit", "both"]).default("both"),
    )
    // ARV-35: `--format json` matches the kubectl/gh/aws-cli convention many
    // users reach for first; until ARV-54 lands a workspace-wide alias layer
    // we accept it locally and forward to `--json`. Other values are rejected
    // (no markdown reporter on coverage) so typos still fail loud.
    .addOption(
      new Option("--format <fmt>", "Alias for --json (parity with kubectl/gh/aws-cli)").choices(["json"]),
    )
    .action(async (opts, cmd: Command) => {
      if (opts.format === "json") opts.json = true;
      // ARV-53: only walk the --api chain when --spec wasn't provided —
      // an explicit spec disables the current-API fallback (coverage's
      // legacy mode supports bare-spec usage).
      const apiFlag = opts.spec ? (opts.api as string | undefined) : getApi(cmd, opts);
      let apiName: string | undefined;
      let spec: string | undefined = opts.spec;

      if (apiFlag) {
        const resolved = resolveApiCollection(apiFlag, opts.db);
        if ("error" in resolved) {
          printError(resolved.error);
          process.exitCode = resolved.error.startsWith("Failed") ? 2 : 1;
          return;
        }
        apiName = apiFlag;
        if (!spec && resolved.spec) spec = resolved.spec;
      }

      // Resolve --union and --session-id. --session-id wins; --union session
      // resolves via .zond/current-session; --union since:/tag:/runs: are
      // routed via discrete loader options so the loader can do one DB query.
      let sessionId: string | undefined = opts.sessionId;
      let runIds: number[] | undefined;
      let sinceIso: string | undefined;
      let tag: string | undefined;
      if (opts.union) {
        try {
          const parsed = parseUnion(opts.union as string);
          if (parsed.kind === "session") {
            const current = readCurrentSession();
            if (!current) {
              // ARV-234: when there's no active session, peek at the most
              // recent one — agents typically hit this right after
              // `session end`. Surface its id in the error so the recovery
              // path is one copy-paste instead of `db sessions`-spelunking.
              let hint = "";
              try {
                const recent = listSessions(1, 0);
                if (recent.length > 0) {
                  const r = recent[0]!;
                  const endedAt = r.finished_at ? ` (ended ${r.finished_at})` : "";
                  hint = ` Most recent session: --session-id ${r.session_id}${endedAt}.`;
                }
              } catch { /* best effort */ }
              printError(`--union session requires an active session (run 'zond session start' first), or pass --session-id <id>.${hint}`);
              process.exitCode = 2;
              return;
            }
            sessionId = current.id;
          } else if (parsed.kind === "since") {
            // Anchor the window at "now minus dur" — coverage CLI is
            // wall-clock-driven, the loader just sees the resolved ISO.
            sinceIso = new Date(Date.now() - parsed.durationMs).toISOString();
          } else if (parsed.kind === "tag") {
            tag = parsed.name;
          } else {
            runIds = parsed.ids;
          }
        } catch (err) {
          printError(err instanceof Error ? err.message : String(err));
          process.exitCode = 2;
          return;
        }
      }

      // since:/tag: only make sense with an API resolved (they query the
      // collection's run history). Fail fast rather than silently scoping to
      // every collection.
      if ((sinceIso || tag) && !apiName) {
        printError("--union since:/tag: requires an API. Pass --api <name> or set the current API.");
        process.exitCode = 2;
        return;
      }

      // ARV-71 (feedback round-02 / F12): when --api X is set and a zond
      // session is active with more than one run, auto-promote the default
      // to `--union session`. The pre-ARV-71 behaviour ("latest run only")
      // misreads as a coverage regression every time a user runs a partial
      // suite mid-session, and the previous stderr hint was easy to miss
      // (the percentage already looked like a regression). Explicit
      // selectors win, --json keeps the envelope untouched.
      const noSelector = !opts.runId && !sessionId && !runIds && !sinceIso && !tag;
      let promotedToSession = false;
      if (apiName && noSelector) {
        const current = readCurrentSession();
        if (current) {
          const sessRuns = listRunsBySession(current.id);
          if (sessRuns.length > 1) {
            sessionId = current.id;
            promotedToSession = true;
            if (!globalJson(cmd)) {
              process.stderr.write(
                `zond: active session has ${sessRuns.length} runs — defaulting to --union session (pass --run-id <N> for a single run).\n`,
              );
            }
          }
        }
        // ARV-41: warn when the latest run is probe-only — otherwise
        // `zond coverage` right after `zond run apis/<api>/probes/...`
        // looks like a regression vs the prior smoke/CRUD run.
        try {
          const collection = findCollectionByNameOrId(apiName);
          if (collection) {
            // ARV-55: peek at the absolute latest run (`runKind: 'any'`).
            // Coverage's default loader query already skips probe runs
            // via `run_kind = 'regular'`, so the user won't see a
            // regression — but if their *most recent* invocation was a
            // probe-only run, the inline warning keeps it visible.
            const latest = getLatestRunByCollection(collection.id, { runKind: "any" });
            if (latest && latest.run_kind === "probe") {
              const hint = `Latest run #${latest.id} only executed probe suites — coverage falls back to the prior smoke/CRUD run. ` +
                `For combined coverage, wrap your runs in 'zond session start/end' and pass '--union session' here.`;
              process.stderr.write(`zond: ${hint}\n`);
            }
            // ARV-81: parity with the session-promotion footer above —
            // when we *don't* promote to --union session (no session, or
            // session has 1 run), tell the user which run they're seeing
            // so the single-run snapshot can't be mistaken for a regression.
            if (!promotedToSession && !globalJson(cmd)) {
              const regular = getLatestRunByCollection(collection.id, { runKind: "regular" });
              if (regular) {
                process.stderr.write(
                  `zond: using latest run #${regular.id}. For union, pass '--union since:<dur>' or '--union runs:<a,b,...>'.\n`,
                );
              }
            }
          }
        } catch { /* DB inspection is best-effort, don't break coverage */ }
      }

      const scope = (opts.scope === "test" || opts.scope === "audit") ? opts.scope : "both";
      process.exitCode = await coverageCommand({
        ...(apiName ? { apiName } : {}),
        ...(spec ? { spec } : {}),
        failOnCoverage: opts.failOnCoverage,
        runId: opts.runId,
        ...(runIds ? { runIds } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(sinceIso ? { sinceIso } : {}),
        ...(tag ? { tag } : {}),
        json: globalJson(cmd),
        verbose: opts.verbose === true,
        scope,
      });
    });
}
