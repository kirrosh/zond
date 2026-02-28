import { tool } from "ai";
import { z } from "zod";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../generator/openapi-reader.ts";
import { generateSuites, writeSuites } from "../../generator/skeleton.ts";

export const generateTestsTool = tool({
  description: "Generate skeleton API test YAML files from an OpenAPI spec",
  inputSchema: z.object({
    specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML)"),
    outputDir: z.string().optional().describe("Output directory (default: ./generated/)"),
  }),
  execute: async (args) => {
    try {
      const outputDir = args.outputDir ?? "./generated/";
      const doc = await readOpenApiSpec(args.specPath);
      const endpoints = extractEndpoints(doc);
      const securitySchemes = extractSecuritySchemes(doc);
      const baseUrl = (doc as any).servers?.[0]?.url;
      const suites = generateSuites(endpoints, baseUrl, securitySchemes);
      const { written, skipped } = await writeSuites(suites, outputDir);

      return {
        suitesGenerated: suites.length,
        written,
        skipped,
        outputDir,
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
});
