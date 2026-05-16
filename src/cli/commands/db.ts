import { getCollections, getRuns, getRunDetail, diagnoseRun, compareRuns } from "../../core/diagnostics/db-analysis.ts";
import { getFilteredResults, getLatestFailingRunId, getLatestRunId } from "../../db/queries.ts";
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
}

export async function dbCommand(options: DbOptions): Promise<number> {
  const { subcommand, positional, json } = options;

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
            console.log(JSON.stringify({ run_id: id, count: results.length, results }, null, 2));
          }
        } else {
          const detail = getRunDetail(id, options.verbose, options.dbPath);
          if (json) {
            printJson(jsonOk("db run", detail));
          } else {
            console.log(JSON.stringify(detail, null, 2));
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
              console.log(JSON.stringify({ ...result, resolution: "latest-no-failures", run_id: fallback }, null, 2));
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
          console.log(JSON.stringify({ ...result, resolution, run_id: id }, null, 2));
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
          console.log(JSON.stringify(result, null, 2));
        }
        return 0;
      }

      default: {
        const msg = `Unknown db subcommand: ${subcommand}. Available: collections, runs, run, diagnose, compare`;
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
    .option("--db <path>", "Path to SQLite database file")
    .action(async (id: string, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "run",
        positional: [id],
        verbose: opts.verbose === true,
        method: opts.method,
        status: opts.status,
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
    .option("--db <path>", "Path to SQLite database file")
    .action(async (id: string | undefined, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "diagnose",
        positional: id !== undefined ? [id] : [],
        limit: opts.limit,
        verbose: opts.verbose === true,
        latest: opts.latest === true,
        runId: opts.runId,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("compare <idA> <idB>")
    .description("Compare two runs")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (idA: string, idB: string, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "compare",
        positional: [idA, idB],
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });
}
