import { tool } from "ai";
import { z } from "zod";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes, sanitizeEnvName } from "../../generator/index.ts";
import { generateSuites, writeSuites } from "../../generator/skeleton.ts";
import { getDb } from "../../../db/schema.ts";
import { upsertEnvironment } from "../../../db/queries.ts";

export const generateTestsTool = tool({
  description: "Generate skeleton API test YAML files from an OpenAPI spec",
  inputSchema: z.object({
    specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML)"),
    outputDir: z.string().optional().describe("Output directory (default: ./generated/)"),
    envName: z.string().optional().describe("Environment name for saving variables to DB"),
    authToken: z.string().optional().describe("Bearer auth token to save in environment"),
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

      // Save environment to DB if envName or authToken provided
      let environmentName: string | undefined;
      if (args.envName || args.authToken) {
        try {
          getDb();
          const specName = (doc as any).info?.title ?? "api";
          const resolvedEnvName = args.envName ?? sanitizeEnvName(specName);
          const envVars: Record<string, string> = {};
          if (baseUrl) envVars.base_url = baseUrl;
          if (args.authToken) envVars.auth_token = args.authToken;
          if (Object.keys(envVars).length > 0) {
            upsertEnvironment(resolvedEnvName, envVars);
            environmentName = resolvedEnvName;
          }
        } catch {
          // DB not critical
        }
      }

      return {
        suitesGenerated: suites.length,
        written,
        skipped,
        outputDir,
        ...(environmentName ? { environment: environmentName } : {}),
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
});
