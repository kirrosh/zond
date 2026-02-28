import { tool } from "ai";
import { z } from "zod";
import { getDb } from "../../../db/schema.ts";
import { getRunById, getResultsByRunId } from "../../../db/queries.ts";

export const diagnoseFailureTool = tool({
  description: "Diagnose failures in a test run by analyzing failed steps and their errors",
  inputSchema: z.object({
    runId: z.number().describe("Run ID to diagnose"),
  }),
  execute: async (args) => {
    try {
      getDb();

      const run = getRunById(args.runId);
      if (!run) return { error: `Run ${args.runId} not found` };

      const results = getResultsByRunId(args.runId);
      const failures = results
        .filter((r) => r.status === "fail" || r.status === "error")
        .map((r) => ({
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

      return {
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
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
});
