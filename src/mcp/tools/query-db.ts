import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";
import { getCollections, getRuns, getRunDetail, diagnoseRun, compareRuns } from "../../core/diagnostics/db-analysis.ts";

export function registerQueryDbTool(server: McpServer, dbPath?: string) {
  server.registerTool("query_db", {
    description: TOOL_DESCRIPTIONS.query_db,
    inputSchema: {
      action: z.enum(["list_collections", "list_runs", "get_run_results", "diagnose_failure", "compare_runs"])
        .describe("Query action to perform"),
      runId: z.optional(z.number().int())
        .describe("Run ID (required for get_run_results and diagnose_failure)"),
      runIdB: z.optional(z.number().int())
        .describe("Second run ID (required for compare_runs — this is the newer run)"),
      limit: z.optional(z.number().int().min(1).max(100))
        .describe("Max number of runs to return (default: 20, only for list_runs)"),
      verbose: z.optional(z.boolean())
        .describe("Show full error messages and stack traces (default: false, truncates long traces)"),
    },
  }, async ({ action, runId, runIdB, limit, verbose }) => {
    try {
      switch (action) {
        case "list_collections": {
          const collections = getCollections(dbPath);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(collections, null, 2) }],
          };
        }

        case "list_runs": {
          const runs = getRuns(limit ?? 20, dbPath);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }],
          };
        }

        case "get_run_results": {
          if (runId == null) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "runId is required for get_run_results" }, null, 2) }],
              isError: true,
            };
          }
          const detail = getRunDetail(runId, verbose, dbPath);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(detail, null, 2) }],
          };
        }

        case "diagnose_failure": {
          if (runId == null) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "runId is required for diagnose_failure" }, null, 2) }],
              isError: true,
            };
          }
          const result = diagnoseRun(runId, verbose, dbPath);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        case "compare_runs": {
          if (runId == null || runIdB == null) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "Both runId (run A) and runIdB (run B) are required for compare_runs" }, null, 2) }],
              isError: true,
            };
          }
          const compareResult = compareRuns(runId, runIdB, dbPath);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(compareResult, null, 2) }],
          };
        }
      }
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
