import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOpenApiSpec, extractEndpoints, scanCoveredEndpoints, filterUncoveredEndpoints } from "../../core/generator/index.ts";

export function registerCoverageAnalysisTool(server: McpServer) {
  server.registerTool("coverage_analysis", {
    description: "Analyze API test coverage by comparing an OpenAPI spec against existing test files",
    inputSchema: {
      specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML)"),
      testsDir: z.string().describe("Path to directory with test YAML files"),
    },
  }, async ({ specPath, testsDir }) => {
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

      const result = {
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
