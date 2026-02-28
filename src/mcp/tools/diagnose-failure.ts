import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { getRunById, getResultsByRunId } from "../../db/queries.ts";

export function registerDiagnoseFailureTool(server: McpServer, dbPath?: string) {
  server.registerTool("diagnose_failure", {
    description: "Diagnose failures in a test run — analyze failed steps, errors, and assertion mismatches",
    inputSchema: {
      runId: z.number().int().describe("Run ID to diagnose"),
    },
  }, async ({ runId }) => {
    try {
      getDb(dbPath);

      const run = getRunById(runId);
      if (!run) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Run ${runId} not found` }, null, 2) }],
          isError: true,
        };
      }

      const results = getResultsByRunId(runId);
      const failures = results
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
          id: run.id,
          started_at: run.started_at,
          environment: run.environment,
          duration_ms: run.duration_ms,
        },
        summary: {
          total: run.total,
          passed: run.passed,
          failed: run.failed,
        },
        failures,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
