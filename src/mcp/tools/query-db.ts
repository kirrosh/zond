import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { listCollections, listRuns, getRunById, getResultsByRunId } from "../../db/queries.ts";

export function registerQueryDbTool(server: McpServer, dbPath?: string) {
  server.registerTool("query_db", {
    description:
      "Query the apitool database. Actions: list_collections (all APIs with run stats), " +
      "list_runs (recent test runs), get_run_results (full detail for a run), " +
      "diagnose_failure (only failed/errored steps for a run).",
    inputSchema: {
      action: z.enum(["list_collections", "list_runs", "get_run_results", "diagnose_failure"])
        .describe("Query action to perform"),
      runId: z.optional(z.number().int())
        .describe("Run ID (required for get_run_results and diagnose_failure)"),
      limit: z.optional(z.number().int().min(1).max(100))
        .describe("Max number of runs to return (default: 20, only for list_runs)"),
    },
  }, async ({ action, runId, limit }) => {
    try {
      getDb(dbPath);

      switch (action) {
        case "list_collections": {
          const collections = listCollections();
          return {
            content: [{ type: "text" as const, text: JSON.stringify(collections, null, 2) }],
          };
        }

        case "list_runs": {
          const runs = listRuns(limit ?? 20);
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
          const run = getRunById(runId);
          if (!run) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: `Run ${runId} not found` }, null, 2) }],
              isError: true,
            };
          }
          const results = getResultsByRunId(runId);
          const detail = {
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
              error_message: r.error_message,
              assertions: r.assertions,
            })),
          };
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
          const diagRun = getRunById(runId);
          if (!diagRun) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: `Run ${runId} not found` }, null, 2) }],
              isError: true,
            };
          }
          const allResults = getResultsByRunId(runId);
          const failures = allResults
            .filter(r => r.status === "fail" || r.status === "error")
            .map(r => ({
              suite_name: r.suite_name,
              test_name: r.test_name,
              status: r.status,
              error_message: r.error_message,
              request_method: r.request_method,
              request_url: r.request_url,
              response_status: r.response_status,
              assertions: r.assertions,
              duration_ms: r.duration_ms,
            }));
          const result = {
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
            },
            failures,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
