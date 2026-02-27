import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { getRunById, getResultsByRunId } from "../../db/queries.ts";

export function registerGetRunResultsTool(server: McpServer, dbPath?: string) {
  server.registerTool("get_run_results", {
    description: "Get detailed results for a specific test run including all step outcomes",
    inputSchema: {
      runId: z.number().int().describe("Run ID to get results for"),
    },
  }, async ({ runId }) => {
    getDb(dbPath);
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
  });
}
