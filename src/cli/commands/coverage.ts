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
   *  `null` for unhit / network-error-only rows. */
  lastStatus: number | null;
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
    const has2xxPass = allResults.some(
      r => r.status === "pass" && r.responseStatus != null && r.responseStatus >= 200 && r.responseStatus < 300,
    );
    const lastStatus = lastObservedStatus(allResults);
    const bucket: RowBucket = {
      endpoint: row.endpoint,
      method: row.method,
      path: row.path,
      lastStatus,
    };
    if (has2xxPass) covered2xx.push(bucket);
    else if (allResults.length > 0) coveredButNon2xx.push(bucket);
    else unhit.push(bucket);
  }
  return { covered2xx, coveredButNon2xx, unhit };
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
  const cov = await loadCoverage({
    apiName: options.apiName!,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.sinceIso ? { sinceIso: options.sinceIso } : {}),
    ...(options.tag ? { tag: options.tag } : {}),
    ...(options.runIds && options.runIds.length > 0 ? { runIds: options.runIds } : {}),
    ...(options.runId != null ? { runId: options.runId } : {}),
  });
  const total = cov.matrix.rows.length;
  if (total === 0) {
    printError("No endpoints found in the OpenAPI spec");
    return 1;
  }

  const { coveredRows, partialRows, uncoveredRows } = classifyRows(cov.matrix);
  const coveredCount = coveredRows.length;
  const percentage = Math.round((coveredCount / total) * 100);

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
    let runLabel: string;
    if (cov.runs.length === 0) {
      runLabel = cov.unionMode
        ? ` — no runs match --union ${cov.unionMode}`
        : " — no runs yet";
    }
    else if (cov.runs.length === 1) runLabel = ` — Run #${cov.runs[0]!.id}`;
    else {
      const modeLabel = cov.unionMode ? ` ${cov.unionMode}` : "";
      runLabel = ` — union${modeLabel} of ${cov.runs.length} runs (#${cov.runs.map(r => r.id).join(", #")})`;
    }
    // TASK-270: show both metrics on separate lines so CI/triage scripts
    // and humans can pick the one they care about.
    console.log(`Pass-coverage (passing 2xx): ${passCount}/${total} endpoints (${passPct}%)${runLabel}`);
    console.log(`Hit-coverage  (any response): ${hitCount}/${total} endpoints (${hitPct}%)`);
    // ARV-19: explicit gap-disclosure so users running `zond checks run`
    // alongside don't assume probes contribute. Only `zond run` results
    // land in the run table that coverage reads from.
    console.log(`  ${color ? DIM : ""}(source: \`zond run\` results only — \`zond checks run\` probes are not counted)${color ? RESET : ""}`);
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
    const buckets = bucketRows(cov.matrix);
    printJson(jsonOk("coverage", {
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
    }));
  }

  if (options.failOnCoverage !== undefined) {
    return percentage < options.failOnCoverage ? 1 : 0;
  }
  return uncoveredRows.length > 0 ? 1 : 0;
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
    const unhit = allEndpoints.map((ep) => ({
      endpoint: `${ep.method.toUpperCase()} ${ep.path}`,
      method: ep.method.toUpperCase(),
      path: ep.path,
      lastStatus: null,
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
      // TASK-270: the spec-only path has no run results, so both metrics
      // are zero. Surface them anyway for shape-stable JSON.
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
import { globalJson, resolveApiCollection } from "../resolve.ts";
import { parseInteger, parsePercentage } from "../argv.ts";
import { readCurrentApi } from "../../core/context/current.ts";
import { readCurrentSession } from "../../core/context/session.ts";
import { listRunsBySession } from "../../db/queries.ts";

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
      "metrics side-by-side (TASK-270):\n" +
      "  pass-coverage  — endpoint had at least one passing 2xx response (strict; what CI usually wants)\n" +
      "  hit-coverage   — endpoint received any response at all, including 5xx and assertion failures (loose; for breadth audits)\n" +
      "\n" +
      "Source: only `zond run` results are aggregated (ARV-19). `zond checks " +
      "run` probes hit the API but are not stored as run results, so they " +
      "don't move either metric — generate suites with `zond generate` and " +
      "execute them via `zond run` to grow coverage.\n" +
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
      "Exit codes: 0 = every endpoint covered (or pass-coverage ≥ " +
      "--fail-on-coverage when set); 1 = uncovered endpoints remain (or " +
      "pass-coverage < --fail-on-coverage); 2 = bad input or read error. " +
      "--fail-on-coverage gates pass-coverage, not hit-coverage.",
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
    .action(async (opts, cmd: Command) => {
      const apiFlag = (opts.api as string | undefined) ?? (opts.spec ? undefined : readCurrentApi() ?? undefined);
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
              printError("--union session requires an active session (run 'zond session start' first), or pass --session-id <id>.");
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

      // Hint when an active session has multiple runs but the user defaulted
      // to "latest run only". Skip when --json (don't pollute envelope) or
      // any explicit selector is set.
      const noSelector = !opts.runId && !sessionId && !runIds && !sinceIso && !tag;
      if (apiName && noSelector && !globalJson(cmd)) {
        const current = readCurrentSession();
        if (current) {
          const sessRuns = listRunsBySession(current.id);
          if (sessRuns.length > 1) {
            const hint = `Active session has ${sessRuns.length} runs. ` +
              `Coverage shows the latest only — pass '--union session' to combine all runs in the session.`;
            process.stderr.write(`zond: ${hint}\n`);
          }
        }
      }

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
      });
    });
}
