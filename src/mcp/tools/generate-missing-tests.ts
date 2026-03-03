import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  scanCoveredEndpoints,
  filterUncoveredEndpoints,
} from "../../core/generator/index.ts";
import { compressEndpointsWithSchemas, buildGenerationGuide } from "./generate-tests-guide.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

export function registerGenerateMissingTestsTool(server: McpServer) {
  server.registerTool("generate_missing_tests", {
    description: TOOL_DESCRIPTIONS.generate_missing_tests,
    inputSchema: {
      specPath: z.string().describe("Path or URL to OpenAPI spec file"),
      testsDir: z.string().describe("Path to directory with existing test YAML files"),
      outputDir: z.optional(z.string()).describe("Directory for saving new test files (default: same as testsDir)"),
      methodFilter: z.optional(z.array(z.string())).describe("Only include endpoints with these HTTP methods (e.g. [\"GET\"] for smoke tests)"),
    },
  }, async ({ specPath, testsDir, outputDir, methodFilter }) => {
    try {
      const doc = await readOpenApiSpec(specPath);
      let allEndpoints = extractEndpoints(doc);
      const securitySchemes = extractSecuritySchemes(doc);
      const baseUrl = ((doc as any).servers?.[0]?.url) as string | undefined;
      const title = (doc as any).info?.title as string | undefined;

      // Apply method filter before coverage check
      if (methodFilter && methodFilter.length > 0) {
        const methods = methodFilter.map(m => m.toUpperCase());
        allEndpoints = allEndpoints.filter(ep => methods.includes(ep.method.toUpperCase()));
      }

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

      if (uncovered.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              fullyCovered: true,
              percentage: 100,
              totalEndpoints: allEndpoints.length,
              covered: coveredCount,
            }, null, 2),
          }],
        };
      }

      // Build guide for uncovered endpoints only
      const apiContext = compressEndpointsWithSchemas(uncovered, securitySchemes);
      const coverageHeader = `## Coverage: ${coveredCount}/${allEndpoints.length} endpoints covered (${percentage}%). Generating tests for ${uncovered.length} uncovered endpoints:`;

      const guide = buildGenerationGuide({
        title: title ?? "API",
        baseUrl,
        apiContext,
        outputDir: outputDir ?? testsDir,
        securitySchemes,
        endpointCount: uncovered.length,
        coverageHeader,
      });

      return {
        content: [{ type: "text" as const, text: guide }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
