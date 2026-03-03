import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeRun } from "../../core/runner/execute-run.ts";

export function registerRunTestsTool(server: McpServer, dbPath?: string) {
  server.registerTool("run_tests", {
    description: "Execute API tests from a YAML file or directory and return results summary with failures. " +
      "Use after saving test suites with save_test_suite. Check query_db(action: 'diagnose_failure') for detailed failure analysis.",
    inputSchema: {
      testPath: z.string().describe("Path to test YAML file or directory"),
      envName: z.optional(z.string()).describe("Environment name (loads .env.<name>.yaml)"),
      safe: z.optional(z.boolean()).describe("Run only GET tests (read-only, safe mode)"),
      tag: z.optional(z.array(z.string())).describe("Filter suites by tag (OR logic)"),
      envVars: z.optional(z.record(z.string())).describe("Environment variables to inject (override env file, e.g. {\"TOKEN\": \"xxx\"})"),
      dryRun: z.optional(z.boolean()).describe("Show requests without sending them (always exits 0)"),
    },
  }, async ({ testPath, envName, safe, tag, envVars, dryRun }) => {
    const { runId, results } = await executeRun({
      testPath,
      envName,
      trigger: "mcp",
      dbPath,
      safe,
      tag,
      envVars,
      dryRun,
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

    const hints: string[] = [];
    if (failedSteps.length > 0) {
      hints.push("Use query_db(action: 'diagnose_failure', runId: " + runId + ") for detailed failure analysis");
    }
    hints.push("Ask the user if they want to set up CI/CD to run these tests automatically on push. If yes, use ci_init to generate a workflow and help them push to GitHub/GitLab.");

    const summary = {
      runId,
      total,
      passed,
      failed,
      skipped,
      suites: results.length,
      status: failed === 0 ? "all_passed" : "has_failures",
      ...(failedSteps.length > 0 ? { failures: failedSteps } : {}),
      hints,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
    };
  });
}
