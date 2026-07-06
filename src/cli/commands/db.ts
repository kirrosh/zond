import { stringify as stringifyYaml } from "yaml";
import { getCollections, getRuns, getRunDetail, diagnoseRun, compareRuns } from "../../core/diagnostics/db-analysis.ts";
import { getFilteredResults, getLatestFailingRunId, getLatestRunId, runKindStats, deleteRunsOlderThan } from "../../db/queries.ts";
import { getDb } from "../../db/schema.ts";
import { printError } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { parseStatusFilter, compileStatusFilterToSql, type StatusMatcher } from "../status-filter.ts";

export interface DbOptions {
  subcommand: string;
  positional: string[];
  limit?: number;
  verbose?: boolean;
  dbPath?: string;
  json?: boolean;
  method?: string;
  /** Raw `--status` argument (TASK-140). Parsed lazily so help text can show
   *  the literal user input in error messages. */
  status?: string;
  /** TASK-266: `db diagnose --latest` — pick the most recent run regardless
   *  of failure status (default is most recent failing run). */
  latest?: boolean;
  /** TASK-266: explicit run id override (`--run-id N`). Same effect as
   *  passing the id positionally; kept as a flag because the `zond-triage`
   *  skill and other agents prefer self-documenting flags. */
  runId?: number;
  /** ARV-266: `db prune --older-than <spec>` — cutoff for retention.
   *  Accepts `30d`, `12h`, or a bare integer (days). Omitted ⇒ per-kind
   *  documented defaults are applied. */
  olderThan?: string;
  /** ARV-266: restrict prune to one run_kind. */
  kind?: string;
  /** ARV-266: show what would be deleted without deleting. */
  dryRun?: boolean;
  /** ARV-338: `--report yaml` — emit the same payload as YAML instead of
   *  JSON, so agents can drop it next to suite YAMLs and diff runs as text. */
  report?: string;
}

/** ARV-338: shared stdout emitter for run/diagnose/compare payloads. */
function emitPayload(payload: unknown, format?: string): void {
  console.log(format === "yaml" ? stringifyYaml(payload).trimEnd() : JSON.stringify(payload, null, 2));
}

/** ARV-266: per-run_kind default retention. Noise kinds (check/probe/
 *  request/fixture runs) are cheap to regenerate and dominate DB growth —
 *  drop after a week. `regular` runs are the signal a user compares against
 *  over time — kept forever unless an explicit --older-than says otherwise. */
const RETENTION_DEFAULT_DAYS: Record<string, number | null> = {
  regular: null,
  check: 7,
  probe: 7,
  request: 7,
  fixture: 7,
};

/** ARV-266: parse `30d` / `12h` / `30` into whole days. Returns null on a
 *  malformed spec so the caller can surface a clear error. */
export function parseRetentionDays(spec: string): number | null {
  const m = spec.trim().match(/^(\d+)\s*([dh]?)$/i);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n)) return null;
  if (m[2]?.toLowerCase() === "h") return n / 24;
  return n; // bare number or `d` ⇒ days
}

/** ARV-266: cutoff ISO timestamp `days` before now. */
function cutoffIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export async function dbCommand(options: DbOptions): Promise<number> {
  const { subcommand, positional, json } = options;

  if (options.report !== undefined && options.report !== "yaml" && options.report !== "json") {
    const msg = `Invalid --report format: ${options.report}. Supported: json, yaml`;
    if (json) printJson(jsonError(`db ${subcommand}`, [msg]));
    else printError(msg);
    return 2;
  }
  if (options.report === "yaml" && json) {
    const msg = "--report yaml and --json are mutually exclusive — pick one output format";
    printJson(jsonError(`db ${subcommand}`, [msg]));
    return 2;
  }

  try {
    switch (subcommand) {
      case "collections": {
        const collections = getCollections(options.dbPath);
        if (json) {
          printJson(jsonOk("db collections", { collections }));
        } else {
          if (collections.length === 0) {
            console.log("No collections found.");
          } else {
            for (const c of collections) {
              console.log(`[${(c as any).id}] ${(c as any).name} — ${(c as any).test_path ?? "no test path"}`);
            }
          }
        }
        return 0;
      }

      case "runs": {
        const runs = getRuns(options.limit ?? 10, options.dbPath);
        if (json) {
          printJson(jsonOk("db runs", { runs }));
        } else {
          if (runs.length === 0) {
            console.log("No runs found.");
          } else {
            for (const r of runs) {
              const run = r as any;
              const isFail = run.failed > 0 || (run.total > 0 && run.passed === 0);
              const status = isFail ? "FAIL" : "PASS";
              console.log(`#${run.id} ${status} ${run.passed}/${run.total} passed (${run.started_at})`);
            }
          }
        }
        return 0;
      }

      case "run": {
        const id = parseInt(positional[0] ?? "", 10);
        if (isNaN(id)) {
          const msg = "Missing run ID. Usage: zond db run <id>";
          if (json) printJson(jsonError("db run", [msg]));
          else printError(msg);
          return 2;
        }
        // If filtering by method/status, show filtered results instead of full detail
        if (options.method || options.status !== undefined) {
          getDb(options.dbPath);
          let statusSql: { sql: string; params: number[] } | undefined;
          if (options.status !== undefined) {
            let matcher: StatusMatcher;
            try {
              matcher = parseStatusFilter(options.status);
            } catch (err) {
              const msg = `Invalid --status: ${(err as Error).message}`;
              if (json) printJson(jsonError("db run", [msg]));
              else printError(msg);
              return 2;
            }
            const compiled = compileStatusFilterToSql(matcher, "response_status");
            if (compiled) statusSql = compiled;
          }
          const results = getFilteredResults(id, { method: options.method, statusSql });
          if (json) {
            printJson(jsonOk("db run", { run_id: id, count: results.length, results }));
          } else {
            emitPayload({ run_id: id, count: results.length, results }, options.report);
          }
        } else {
          const detail = getRunDetail(id, options.verbose, options.dbPath);
          if (json) {
            printJson(jsonOk("db run", detail));
          } else {
            emitPayload(detail, options.report);
          }
        }
        return 0;
      }

      case "diagnose": {
        // TASK-266: resolve run id with the priority
        //   explicit positional > --run-id > --latest > last failing run.
        // The bare `zond db diagnose` is the agent-friendly default the
        // `zond-triage` skill relies on; `--latest` exists for "show me the
        // last run, even if it passed".
        getDb(options.dbPath);
        let id: number | null = null;
        let resolution: "explicit" | "run-id-flag" | "latest" | "latest-failing" = "explicit";
        const positionalRaw = positional[0];
        if (positionalRaw !== undefined && positionalRaw !== "") {
          const n = parseInt(positionalRaw, 10);
          if (isNaN(n)) {
            const msg = `Invalid run id: ${positionalRaw}. Expected a positive integer.`;
            if (json) printJson(jsonError("db diagnose", [msg]));
            else printError(msg);
            return 2;
          }
          id = n;
        } else if (options.runId !== undefined) {
          id = options.runId;
          resolution = "run-id-flag";
        } else if (options.latest) {
          id = getLatestRunId();
          resolution = "latest";
        } else {
          id = getLatestFailingRunId();
          resolution = "latest-failing";
          if (id == null) {
            // No failures — fall back to the latest run so the user still
            // gets a useful payload, with a "no failures" hint.
            const fallback = getLatestRunId();
            if (fallback == null) {
              const msg = "No runs in the database yet. Try `zond run <suite>` first.";
              if (json) printJson(jsonError("db diagnose", [msg]));
              else printError(msg);
              return 1;
            }
            const result = diagnoseRun(fallback, options.verbose, options.dbPath, options.limit);
            const warning = `No failing runs — diagnosing latest run #${fallback} (all passed).`;
            if (json) {
              printJson(jsonOk("db diagnose", { ...result, resolution: "latest-no-failures", run_id: fallback }, [warning]));
            } else {
              process.stderr.write(`zond: ${warning}\n`);
              emitPayload({ ...result, resolution: "latest-no-failures", run_id: fallback }, options.report);
            }
            return 0;
          }
        }
        if (id == null) {
          const msg = "Missing run ID. Usage: zond db diagnose [id] (default: last failing run)";
          if (json) printJson(jsonError("db diagnose", [msg]));
          else printError(msg);
          return 2;
        }
        const result = diagnoseRun(id, options.verbose, options.dbPath, options.limit);
        if (json) {
          printJson(jsonOk("db diagnose", { ...result, resolution, run_id: id }));
        } else {
          // ARV-208: in human mode, embed resolution + run_id in the stdout
          // JSON so users (and the zond-triage skill) don't need --json just
          // to discover which run was auto-selected by `zond db diagnose --api`.
          // The stderr hint stays as a quick visual cue when running interactively.
          if (resolution !== "explicit") {
            const label = resolution === "latest-failing"
              ? `last failing run #${id}`
              : resolution === "latest"
                ? `latest run #${id}`
                : `run #${id}`;
            process.stderr.write(`zond: diagnosing ${label}\n`);
          }
          emitPayload({ ...result, resolution, run_id: id }, options.report);
        }
        return 0;
      }

      case "compare": {
        const idA = parseInt(positional[0] ?? "", 10);
        const idB = parseInt(positional[1] ?? "", 10);
        if (isNaN(idA) || isNaN(idB)) {
          const msg = "Missing run IDs. Usage: zond db compare <idA> <idB>";
          if (json) printJson(jsonError("db compare", [msg]));
          else printError(msg);
          return 2;
        }
        const result = compareRuns(idA, idB, options.dbPath);
        if (json) {
          printJson(jsonOk("db compare", result));
        } else {
          emitPayload(result, options.report);
        }
        return 0;
      }

      case "stats": {
        // ARV-266: per-kind row counts so users see DB growth before it bites.
        getDb(options.dbPath);
        const stats = runKindStats();
        const totalRuns = stats.reduce((a, s) => a + s.runs, 0);
        const totalResults = stats.reduce((a, s) => a + s.results, 0);
        if (json) {
          printJson(jsonOk("db stats", { by_kind: stats, totals: { runs: totalRuns, results: totalResults } }));
        } else if (stats.length === 0) {
          console.log("No runs in the database yet.");
        } else {
          console.log(`Row counts by run_kind (${totalRuns} runs, ${totalResults} result rows):`);
          for (const s of stats) {
            const retention = RETENTION_DEFAULT_DAYS[s.run_kind];
            const ret = retention == null ? "kept forever" : `default prune ${retention}d`;
            console.log(`  ${s.run_kind.padEnd(9)} ${String(s.runs).padStart(6)} runs  ${String(s.results).padStart(8)} results  (${ret})`);
          }
          console.log("\nPrune noise kinds with `zond db prune` (per-kind defaults) or `zond db prune --older-than 30d`.");
        }
        return 0;
      }

      case "prune": {
        // ARV-266: explicit, opt-in retention — never runs unless the user
        // asks. Default (no --older-than) applies the documented per-kind
        // cutoffs; `regular` runs are never dropped by the defaults.
        getDb(options.dbPath);
        const now = new Date();
        // Build the (kind, cutoffIso) work-list.
        let jobs: Array<{ kind?: string; cutoff: string; label: string }> = [];
        if (options.olderThan) {
          const days = parseRetentionDays(options.olderThan);
          if (days == null) {
            const msg = `Invalid --older-than "${options.olderThan}" (expected e.g. 30d, 12h, or a day count).`;
            if (json) printJson(jsonError("db prune", [msg])); else printError(msg);
            return 2;
          }
          jobs = [{ kind: options.kind, cutoff: cutoffIso(days, now), label: `${options.kind ?? "all"} < ${options.olderThan}` }];
        } else {
          // Per-kind defaults. A --kind filter narrows to that one kind.
          for (const [kind, retDays] of Object.entries(RETENTION_DEFAULT_DAYS)) {
            if (retDays == null) continue; // regular ⇒ forever
            if (options.kind && options.kind !== kind) continue;
            jobs.push({ kind, cutoff: cutoffIso(retDays, now), label: `${kind} < ${retDays}d` });
          }
          if (options.kind && RETENTION_DEFAULT_DAYS[options.kind] == null) {
            const msg = `run_kind "${options.kind}" is retained forever by default. Pass --older-than to prune it explicitly.`;
            if (json) printJson(jsonOk("db prune", { deleted: [], dry_run: options.dryRun === true, note: msg }, [msg]));
            else console.log(msg);
            return 0;
          }
        }

        const deleted: Array<{ scope: string; runs: number; results: number }> = [];
        for (const jobItem of jobs) {
          if (options.dryRun) {
            // Count-only: reuse the delete query's SELECT by inspecting stats
            // is imprecise, so do a lightweight targeted count.
            const { getDb: gd } = await import("../../db/schema.ts");
            const dbh = gd();
            const kindClause = jobItem.kind ? "AND run_kind = ?" : "";
            const params = jobItem.kind ? [jobItem.cutoff, jobItem.kind] : [jobItem.cutoff];
            const row = dbh.query(`SELECT COUNT(*) AS runs FROM runs WHERE started_at < ? ${kindClause}`).get(...params) as { runs: number };
            deleted.push({ scope: jobItem.label, runs: row.runs, results: 0 });
          } else {
            const r = deleteRunsOlderThan(jobItem.cutoff, jobItem.kind);
            deleted.push({ scope: jobItem.label, runs: r.runs, results: r.results });
          }
        }
        const totalRuns = deleted.reduce((a, d) => a + d.runs, 0);
        if (!options.dryRun && totalRuns > 0) {
          // Reclaim freed pages after a large delete.
          const { getDb: gd } = await import("../../db/schema.ts");
          gd().exec("VACUUM");
        }
        if (json) {
          printJson(jsonOk("db prune", { deleted, total_runs: totalRuns, dry_run: options.dryRun === true }));
        } else if (totalRuns === 0) {
          console.log(options.dryRun ? "Nothing would be pruned." : "Nothing to prune.");
        } else {
          console.log(`${options.dryRun ? "Would prune" : "Pruned"} ${totalRuns} run(s):`);
          for (const d of deleted) {
            if (d.runs > 0) console.log(`  ${d.scope.padEnd(20)} ${d.runs} run(s)${options.dryRun ? "" : `, ${d.results} result row(s)`}`);
          }
          if (!options.dryRun) console.log("VACUUM reclaimed freed pages.");
        }
        return 0;
      }

      default: {
        const msg = `Unknown db subcommand: ${subcommand}. Available: collections, runs, run, diagnose, compare, stats, prune`;
        if (json) printJson(jsonError("db", [msg]));
        else printError(msg);
        return 2;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      printJson(jsonError(`db ${subcommand}`, [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}

import type { Command } from "commander";
import { globalJson } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";

export function registerDb(program: Command): void {
  const db = program.command("db").description("Query the test database");

  db
    .command("collections")
    .description("List all API collections")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "collections",
        positional: [],
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("runs")
    .description("List recent test runs")
    .option("--limit <N>", "Maximum number of runs to display", parsePositiveInt("--limit"))
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "runs",
        positional: [],
        limit: opts.limit,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("run <id>")
    .description("Show run details")
    .option("--verbose", "Show all results")
    .option("--method <method>", "Filter by HTTP method")
    .option(
      "--status <expr>",
      "Filter by HTTP status. Accepts: exact code (502), class (5xx), range (500-599), comparison (>=500, <400), or comma-separated mix (5xx,429).",
    )
    .option("--report <format>", "Output format: json (default) or yaml (ARV-338: agent-friendly run snapshot)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (id: string, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "run",
        positional: [id],
        verbose: opts.verbose === true,
        method: opts.method,
        status: opts.status,
        report: opts.report,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("diagnose [id]")
    .description("Diagnose run failures. Without [id]: defaults to the most recent failing run (TASK-266); falls back to latest run with a 'no failures' note when nothing has failed.")
    .option("--latest", "Diagnose the most recent run regardless of status (TASK-266)")
    .option("--run-id <N>", "Explicit run id override (same as positional [id]; preferred form for agents)", parsePositiveInt("--run-id"))
    .option("--limit <N>", "Examples per failure group", parsePositiveInt("--limit"))
    .option("--verbose", "Show all examples (not grouped)")
    .option("--report <format>", "Output format: json (default) or yaml (ARV-338: agent-friendly summary)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (id: string | undefined, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "diagnose",
        positional: id !== undefined ? [id] : [],
        limit: opts.limit,
        verbose: opts.verbose === true,
        latest: opts.latest === true,
        runId: opts.runId,
        report: opts.report,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("compare <idA> <idB>")
    .description("Compare two runs")
    .option("--report <format>", "Output format: json (default) or yaml (ARV-338: agent-friendly diff)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (idA: string, idB: string, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "compare",
        positional: [idA, idB],
        report: opts.report,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("stats")
    .description("ARV-266: row counts per run_kind + default retention, so DB growth is visible before it bites")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "stats",
        positional: [],
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("prune")
    .description("ARV-266: delete old runs to bound DB growth. Default (no --older-than) applies per-kind retention: check/probe/request/fixture runs older than 7d are dropped; 'regular' runs are kept forever. VACUUMs after a delete. Opt-in — never runs unless invoked.")
    .option("--older-than <spec>", "Uniform cutoff for all kinds (e.g. 30d, 12h, or a day count). Overrides per-kind defaults; prunes 'regular' too.")
    .option("--kind <run_kind>", "Restrict to one run_kind: regular | check | probe | request | fixture")
    .option("--dry-run", "Report what would be deleted without deleting")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "prune",
        positional: [],
        olderThan: opts.olderThan,
        kind: opts.kind,
        dryRun: opts.dryRun === true,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });
}
