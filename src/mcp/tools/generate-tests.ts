import { z } from "zod";
import { resolve, basename } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes, generateSuites, writeSuites, isRelativeUrl, sanitizeEnvName } from "../../core/generator/index.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByTestPath, createCollection, normalizePath, upsertEnvironment } from "../../db/queries.ts";

export function registerGenerateTestsTool(server: McpServer, dbPath?: string) {
  server.registerTool("generate_tests", {
    description: "Generate skeleton API test YAML files from an OpenAPI spec",
    inputSchema: {
      specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML)"),
      outputDir: z.optional(z.string()).describe("Output directory (default: ./generated/)"),
      envName: z.optional(z.string()).describe("Environment name for saving variables to DB"),
      authToken: z.optional(z.string()).describe("Bearer auth token to save in environment"),
    },
  }, async ({ specPath, outputDir, envName, authToken }) => {
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

    const specName = (doc as any).info?.title ?? basename(specPath);
    let collectionName: string | undefined;
    let environmentName: string | undefined;

    // Create collection and save environment to DB
    try {
      getDb(dbPath);

      // Auto-create collection
      const normalizedOutput = normalizePath(output);
      const existing = findCollectionByTestPath(normalizedOutput);
      if (!existing) {
        createCollection({
          name: specName,
          test_path: normalizedOutput,
          openapi_spec: resolve(specPath),
        });
      }
      collectionName = specName;

      // Build and save environment
      const resolvedEnvName = envName ?? sanitizeEnvName(specName);
      const envVars: Record<string, string> = {};

      if (baseUrl) {
        envVars.base_url = baseUrl;
      }

      if (authToken) {
        envVars.auth_token = authToken;
      }

      const hasBearerAuth = securitySchemes.some(s => s.type === "http" && s.scheme === "bearer");
      if (hasBearerAuth && !authToken) {
        envVars.auth_username = "admin";
        envVars.auth_password = "admin";
      }

      const apiKeySchemes = securitySchemes.filter(s => s.type === "apiKey");
      for (const apiKey of apiKeySchemes) {
        const varName = apiKey.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        envVars[varName] = `YOUR_${varName.toUpperCase()}`;
      }

      if (Object.keys(envVars).length > 0) {
        upsertEnvironment(resolvedEnvName, envVars);
        environmentName = resolvedEnvName;
      }
    } catch {
      // DB not critical
    }

    // Count destructive endpoints
    const destructiveCount = endpoints.filter(ep => {
      const m = ep.method.toUpperCase();
      return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
    }).length;

    const result: Record<string, unknown> = {
      endpoints: endpoints.length,
      suites: suites.length,
      files,
      outputDir: output,
      ...(collectionName ? { collection: collectionName } : {}),
      ...(environmentName ? { environment: environmentName } : {}),
      ...(destructiveCount > 0 ? { destructiveTests: destructiveCount, safeRunHint: "Use safe: true to run only GET tests" } : {}),
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  });
}
