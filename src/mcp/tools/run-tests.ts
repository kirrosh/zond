import { z } from "zod";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeRun } from "../../core/runner/execute-run.ts";
import { getDb } from "../../db/schema.ts";
import { getResultsByRunId, findCollectionByTestPath } from "../../db/queries.ts";
import { readOpenApiSpec, extractEndpoints, scanCoveredEndpoints, filterUncoveredEndpoints } from "../../core/generator/index.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

export function registerRunTestsTool(server: McpServer, dbPath?: string) {
  server.registerTool("run_tests", {
    description: TOOL_DESCRIPTIONS.run_tests,
    inputSchema: {
      testPath: z.string().describe("Path to test YAML file or directory"),
      envName: z.optional(z.string()).describe("Environment name (loads .env.<name>.yaml)"),
      safe: z.optional(z.boolean()).describe("Run only GET tests (read-only, safe mode)"),
      tag: z.optional(z.array(z.string())).describe("Filter suites by tag (OR logic)"),
      envVars: z.optional(z.record(z.string(), z.string())).describe("Environment variables to inject (override env file, e.g. {\"TOKEN\": \"xxx\"})"),
      dryRun: z.optional(z.boolean()).describe("Show requests without sending them (always exits 0)"),
      rerunFrom: z.optional(z.number().int()).describe("Re-run only tests that failed/errored in this run ID"),
    },
  }, async ({ testPath, envName, safe, tag, envVars, dryRun, rerunFrom }) => {
    // Build filter from previous failed run
    let rerunFilter: Set<string> | undefined;
    if (rerunFrom != null) {
      getDb(dbPath);
      const prevResults = getResultsByRunId(rerunFrom);
      const failed = prevResults.filter(r => r.status === "fail" || r.status === "error");
      if (failed.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Run ${rerunFrom} has no failures to rerun` }, null, 2) }],
          isError: true,
        };
      }
      rerunFilter = new Set(failed.map(r => `${r.suite_name}::${r.test_name}`));
    }

    const { runId, results } = await executeRun({
      testPath,
      envName,
      trigger: "mcp",
      dbPath,
      safe,
      tag,
      envVars,
      dryRun,
      rerunFilter,
    });

    const total = results.reduce((s, r) => s + r.total, 0);
    const passed = results.reduce((s, r) => s + r.passed, 0);
    const failed = results.reduce((s, r) => s + r.failed, 0);
    const skipped = results.reduce((s, r) => s + r.skipped, 0);

    const failedSteps = results.flatMap(r =>
      r.steps.filter(s => s.status === "fail" || s.status === "error").map(s => ({
        suite: r.suite_name,
        test: s.name,
        ...(r.suite_file ? { file: r.suite_file } : {}),
        status: s.status,
        error: s.error,
        assertions: s.assertions.filter(a => !a.passed).map(a => ({
          field: a.field,
          expected: a.expected,
          actual: a.actual,
        })),
      }))
    );

    // Best-effort coverage calculation
    let coverage: { covered: number; total: number; percentage: number } | undefined;
    try {
      const resolvedPath = resolve(testPath);
      const collection = findCollectionByTestPath(resolvedPath);
      if (collection?.openapi_spec) {
        const doc = await readOpenApiSpec(collection.openapi_spec);
        const allEndpoints = extractEndpoints(doc);
        const coveredEps = await scanCoveredEndpoints(collection.test_path);
        const uncovered = filterUncoveredEndpoints(allEndpoints, coveredEps);
        const coveredCount = allEndpoints.length - uncovered.length;
        coverage = {
          covered: coveredCount,
          total: allEndpoints.length,
          percentage: allEndpoints.length > 0 ? Math.round((coveredCount / allEndpoints.length) * 100) : 100,
        };
      }
    } catch { /* coverage is best-effort, don't fail run */ }

    const hints: string[] = [];
    if (failedSteps.length > 0) {
      hints.push("Use query_db(action: 'diagnose_failure', runId: " + runId + ") for detailed failure analysis");
      const hasAssertionFailures = failedSteps.some(s => s.assertions.length > 0);
      if (hasAssertionFailures) {
        hints.push(
          "Some tests have assertion failures — use describe_endpoint(specPath, method, path) to verify expected schemas"
        );
      }
    }
    const summary = {
      runId,
      total,
      passed,
      failed,
      skipped,
      suites: results.length,
      status: failed === 0 ? "all_passed" : "has_failures",
      ...(failedSteps.length > 0 ? { failures: failedSteps } : {}),
      ...(coverage ? { coverage } : {}),
      hints,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
    };
  });
}
