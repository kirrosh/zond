import { getCollections, getRuns, getRunDetail, diagnoseRun, compareRuns } from "../../core/diagnostics/db-analysis.ts";
import { printError } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface DbOptions {
  subcommand: string;
  positional: string[];
  limit?: number;
  verbose?: boolean;
  dbPath?: string;
  json?: boolean;
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
              const status = run.failed > 0 ? "FAIL" : "PASS";
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
        const detail = getRunDetail(id, options.verbose, options.dbPath);
        if (json) {
          printJson(jsonOk("db run", detail));
        } else {
          console.log(JSON.stringify(detail, null, 2));
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
        const result = diagnoseRun(id, options.verbose, options.dbPath);
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
