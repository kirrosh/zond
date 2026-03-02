import { tool } from "ai";
import { z } from "zod";
import { executeRun } from "../../runner/execute-run.ts";

export const runTestsTool = tool({
  description: "Run API test suites from a YAML file or directory and return results summary",
  inputSchema: z.object({
    testPath: z.string().describe("Path to test YAML file or directory"),
    envName: z.string().optional().describe("Environment name (loads .env.<name>.yaml)"),
    safe: z.boolean().optional().describe("Run only GET tests (read-only, safe mode)"),
  }),
  execute: async (args) => {
    try {
      const { runId, results } = await executeRun({
        testPath: args.testPath,
        envName: args.envName,
        safe: args.safe,
        trigger: "agent",
      });

      const total = results.reduce((s, r) => s + r.total, 0);
      const passed = results.reduce((s, r) => s + r.passed, 0);
      const failed = results.reduce((s, r) => s + r.failed, 0);
      const skipped = results.reduce((s, r) => s + r.skipped, 0);

      return {
        runId,
        total,
        passed,
        failed,
        skipped,
        status: failed > 0 ? "has_failures" : "all_passed",
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
});
