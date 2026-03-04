import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOpenApiSpec, extractEndpoints, scanCoveredEndpoints, filterUncoveredEndpoints, normalizePath, specPathToRegex, analyzeEndpoints } from "../../core/generator/index.ts";
import { getDb } from "../../db/schema.ts";
import { getResultsByRunId, getRunById } from "../../db/queries.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

function extractPathFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    // If not a full URL, treat as path directly
    return url.startsWith("/") ? url : null;
  }
}

export function registerCoverageAnalysisTool(server: McpServer, dbPath?: string) {
  server.registerTool("coverage_analysis", {
    description: TOOL_DESCRIPTIONS.coverage_analysis,
    inputSchema: {
      specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML)"),
      testsDir: z.string().describe("Path to directory with test YAML files"),
      failThreshold: z.optional(z.number().min(0).max(100)).describe("Return isError when coverage % is below this threshold (0–100)"),
      runId: z.optional(z.number().int()).describe("Run ID to cross-reference test results for pass/fail/5xx breakdown"),
    },
  }, async ({ specPath, testsDir, failThreshold, runId }) => {
    try {
      const doc = await readOpenApiSpec(specPath);
      const allEndpoints = extractEndpoints(doc);

      if (allEndpoints.length === 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No endpoints found in the spec" }, null, 2) }],
          isError: true,
        };
      }

      const covered = await scanCoveredEndpoints(testsDir);
      const uncovered = filterUncoveredEndpoints(allEndpoints, covered);
      const coveredCount = allEndpoints.length - uncovered.length;
      const percentage = Math.round((coveredCount / allEndpoints.length) * 100);

      // Static warnings
      const warnings = analyzeEndpoints(allEndpoints);

      const result: Record<string, unknown> = {
        totalEndpoints: allEndpoints.length,
        covered: coveredCount,
        uncovered: uncovered.length,
        percentage,
        uncoveredEndpoints: uncovered.map(ep => ({
          method: ep.method,
          path: ep.path,
          summary: ep.summary,
          tags: ep.tags,
        })),
        coveredEndpoints: covered.map(ep => ({
          method: ep.method,
          path: ep.path,
          file: ep.file,
        })),
      };

      if (warnings.length > 0) {
        result.warnings = warnings;
      }

      // Enriched breakdown when runId is provided
      if (runId != null) {
        getDb(dbPath);
        const run = getRunById(runId);
        if (!run) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Run ${runId} not found` }, null, 2) }],
            isError: true,
          };
        }

        const results = getResultsByRunId(runId);

        // Build a map: spec endpoint → status classification
        const endpointStatus = new Map<string, "passing" | "api_error" | "test_failed">();

        for (const r of results) {
          if (!r.request_url || !r.request_method) continue;
          const urlPath = extractPathFromUrl(r.request_url);
          if (!urlPath) continue;
          const normalizedUrl = normalizePath(urlPath);

          // Find matching spec endpoint
          for (const ep of allEndpoints) {
            const regex = specPathToRegex(ep.path);
            if (r.request_method === ep.method && regex.test(normalizedUrl)) {
              const key = `${ep.method} ${ep.path}`;
              const existing = endpointStatus.get(key);

              // Worst status wins: api_error > test_failed > passing
              if (r.response_status !== null && r.response_status >= 500) {
                endpointStatus.set(key, "api_error");
              } else if (r.status === "fail" || r.status === "error") {
                if (existing !== "api_error") {
                  endpointStatus.set(key, "test_failed");
                }
              } else if (!existing) {
                endpointStatus.set(key, "passing");
              }
              break;
            }
          }
        }

        let passing = 0;
        let apiError = 0;
        let testFailed = 0;
        for (const status of endpointStatus.values()) {
          if (status === "passing") passing++;
          else if (status === "api_error") apiError++;
          else if (status === "test_failed") testFailed++;
        }

        result.enriched = {
          passing,
          api_error: apiError,
          test_failed: testFailed,
          not_covered: uncovered.length,
        };
      }

      const belowThreshold = failThreshold !== undefined && percentage < failThreshold;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        ...(belowThreshold ? { isError: true } : {}),
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
