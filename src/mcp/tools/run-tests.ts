import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeRun } from "../../core/runner/execute-run.ts";

export function registerRunTestsTool(server: McpServer, dbPath?: string) {
  server.registerTool("run_tests", {
    description: "Run API tests from a YAML file or directory and return results summary",
    inputSchema: {
      testPath: z.string().describe("Path to test YAML file or directory"),
      envName: z.optional(z.string()).describe("Environment name (loads .env.<name>.yaml)"),
      safe: z.optional(z.boolean()).describe("Run only GET tests (read-only, safe mode)"),
    },
  }, async ({ testPath, envName, safe }) => {
    const { runId, results } = await executeRun({
      testPath,
      envName,
      trigger: "mcp",
      dbPath,
      safe,
    });

    const total = results.reduce((s, r) => s + r.total, 0);
    const passed = results.reduce((s, r) => s + r.passed, 0);
    const failed = results.reduce((s, r) => s + r.failed, 0);
    const skipped = results.reduce((s, r) => s + r.skipped, 0);

    const failedSteps = results.flatMap(r =>
      r.steps.filter(s => s.status === "fail" || s.status === "error").map(s => ({
        suite: r.suite_name,
        test: s.name,
        status: s.status,
        error: s.error,
        assertions: s.assertions.filter(a => !a.passed).map(a => ({
          field: a.field,
          expected: a.expected,
          actual: a.actual,
        })),
      }))
    );

    const summary = {
      runId,
      total,
      passed,
      failed,
      skipped,
      suites: results.length,
      status: failed === 0 ? "all_passed" : "has_failures",
      ...(failedSteps.length > 0 ? { failures: failedSteps } : {}),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
    };
  });
}
