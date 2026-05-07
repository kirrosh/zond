import { getCollections, getRuns, getRunDetail, diagnoseRun, compareRuns } from "../../core/diagnostics/db-analysis.ts";
import { getFilteredResults } from "../../db/queries.ts";
import { getDb } from "../../db/schema.ts";
import { printError } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface DbOptions {
  subcommand: string;
  positional: string[];
  limit?: number;
  verbose?: boolean;
  dbPath?: string;
  json?: boolean;
  method?: string;
  status?: number;
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
          const results = getFilteredResults(id, { method: options.method, status: options.status });
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
        const id = parseInt(positional[0] ?? "", 10);
        if (isNaN(id)) {
          const msg = "Missing run ID. Usage: zond db diagnose <id>";
          if (json) printJson(jsonError("db diagnose", [msg]));
          else printError(msg);
          return 2;
        }
        const result = diagnoseRun(id, options.verbose, options.dbPath, options.limit);
        if (json) {
          printJson(jsonOk("db diagnose", result));
        } else {
          console.log(JSON.stringify(result, null, 2));
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
import { parseInteger, parsePositiveInt } from "../argv.ts";

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
    .option("--status <code>", "Filter by HTTP status code", parseInteger("--status"))
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
    .command("diagnose <id>")
    .description("Diagnose run failures")
    .option("--limit <N>", "Examples per failure group", parsePositiveInt("--limit"))
    .option("--verbose", "Show all examples (not grouped)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (id: string, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "diagnose",
        positional: [id],
        limit: opts.limit,
        verbose: opts.verbose === true,
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
