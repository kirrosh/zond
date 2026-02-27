import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes, generateSuites, writeSuites } from "../../core/generator/index.ts";

export function registerGenerateTestsTool(server: McpServer) {
  server.registerTool("generate_tests", {
    description: "Generate skeleton API test YAML files from an OpenAPI spec",
    inputSchema: {
      specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML)"),
      outputDir: z.optional(z.string()).describe("Output directory (default: ./generated/)"),
    },
  }, async ({ specPath, outputDir }) => {
    const output = outputDir ?? "./generated/";
    const doc = await readOpenApiSpec(specPath);
    const endpoints = extractEndpoints(doc);

    if (endpoints.length === 0) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "No endpoints found in the spec" }, null, 2) }],
        isError: true,
      };
    }

    const baseUrl = (doc as any).servers?.[0]?.url as string | undefined;
    const securitySchemes = extractSecuritySchemes(doc);
    const suites = generateSuites(endpoints, baseUrl, securitySchemes);
    const files = await writeSuites(suites, output);

    const result = {
      endpoints: endpoints.length,
      suites: suites.length,
      files,
      outputDir: output,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  });
}
