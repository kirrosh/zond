import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { listCollections, listRuns, getRunById, getResultsByRunId, getCollectionById } from "../../db/queries.ts";
import { join } from "node:path";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";
import { statusHint, classifyFailure, envHint, envCategory } from "../../core/diagnostics/failure-hints.ts";

function parseBodySafe(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  const truncated = raw.length > 2000 ? raw.slice(0, 2000) + "…[truncated]" : raw;
  try {
    return JSON.parse(raw);
  } catch {
    return truncated;
  }
}

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
    },
  }, async ({ action, runId, runIdB, limit }) => {
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

          // Resolve env file path from collection for actionable hints
          let envFilePath: string | undefined;
          if (diagRun.collection_id) {
            const collection = getCollectionById(diagRun.collection_id);
            if (collection?.base_dir) {
              envFilePath = join(collection.base_dir, ".env.yaml").replace(/\\/g, "/");
            }
          }

          const allResults = getResultsByRunId(runId);
          const failures = allResults
            .filter(r => r.status === "fail" || r.status === "error")
            .map(r => {
              // env issues take priority over generic status hints
              const hint = envHint(r.request_url, r.error_message, envFilePath) ?? statusHint(r.response_status);
              const failure_type = classifyFailure(r.status, r.response_status);
              return {
                suite_name: r.suite_name,
                test_name: r.test_name,
                status: r.status,
                failure_type,
                error_message: r.error_message,
                request_method: r.request_method,
                request_url: r.request_url,
                response_status: r.response_status,
                ...(hint ? { hint } : {}),
                response_body: parseBodySafe(r.response_body),
                response_headers: r.response_headers
                  ? JSON.parse(r.response_headers)
                  : undefined,
                assertions: r.assertions,
                duration_ms: r.duration_ms,
              };
            });

          // Top-level env_issue when all failures have the same env problem category
          const categories = new Set(failures.map(f => envCategory(f.hint)).filter(Boolean));
          const sharedEnvHint = categories.size === 1
            ? categories.has("base_url_missing")
              ? `All failures: base_url is not set — add base_url to ${envFilePath ?? ".env.yaml"}`
              : categories.has("unresolved_variable")
              ? `All failures: some variables are not substituted — check variable names in ${envFilePath ?? ".env.yaml"}`
              : [...failures.map(f => f.hint).filter(Boolean)][0]
            : undefined;

          const apiErrors = failures.filter(f => f.failure_type === "api_error").length;
          const assertionFailures = failures.filter(f => f.failure_type === "assertion_failed").length;
          const networkErrors = failures.filter(f => f.failure_type === "network_error").length;

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
              api_errors: apiErrors,
              assertion_failures: assertionFailures,
              network_errors: networkErrors,
            },
            ...(sharedEnvHint ? { env_issue: sharedEnvHint } : {}),
            failures,
          };
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
          const runARecord = getRunById(runId);
          const runBRecord = getRunById(runIdB);
          if (!runARecord) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: `Run #${runId} not found` }, null, 2) }],
              isError: true,
            };
          }
          if (!runBRecord) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: `Run #${runIdB} not found` }, null, 2) }],
              isError: true,
            };
          }

          const resultsA = getResultsByRunId(runId);
          const resultsB = getResultsByRunId(runIdB);

          const mapA = new Map<string, string>();
          const mapB = new Map<string, string>();
          for (const r of resultsA) mapA.set(`${r.suite_name}::${r.test_name}`, r.status);
          for (const r of resultsB) mapB.set(`${r.suite_name}::${r.test_name}`, r.status);

          const regressions: Array<{ suite: string; test: string; before: string; after: string }> = [];
          const fixes: Array<{ suite: string; test: string; before: string; after: string }> = [];
          let unchanged = 0;
          let newTests = 0;
          let removedTests = 0;

          for (const [key, statusB] of mapB) {
            const statusA = mapA.get(key);
            if (statusA === undefined) { newTests++; continue; }
            const [suite, test] = key.split("::") as [string, string];
            const wasPass = statusA === "pass";
            const isPass = statusB === "pass";
            const wasFail = statusA === "fail" || statusA === "error";
            const isFail = statusB === "fail" || statusB === "error";
            if (wasPass && isFail) regressions.push({ suite, test, before: statusA, after: statusB });
            else if (wasFail && isPass) fixes.push({ suite, test, before: statusA, after: statusB });
            else unchanged++;
          }
          for (const key of mapA.keys()) {
            if (!mapB.has(key)) removedTests++;
          }

          const compareResult = {
            runA: { id: runId, started_at: runARecord.started_at },
            runB: { id: runIdB, started_at: runBRecord.started_at },
            summary: { regressions: regressions.length, fixes: fixes.length, unchanged, newTests, removedTests },
            regressions,
            fixes,
            hasRegressions: regressions.length > 0,
          };
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
