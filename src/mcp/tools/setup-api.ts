import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { setupApi } from "../../core/setup-api.ts";

export function registerSetupApiTool(server: McpServer, dbPath?: string) {
  server.registerTool("setup_api", {
    description: "Register a new API for testing. Creates directory structure, reads OpenAPI spec, " +
      "sets up environment variables, and creates a collection in the database. " +
      "Use this before generating tests for a new API.",
    inputSchema: {
      name: z.string().describe("API name (e.g. 'petstore')"),
      specPath: z.optional(z.string()).describe("Path or URL to OpenAPI spec"),
      dir: z.optional(z.string()).describe("Base directory (default: ./apis/<name>/)"),
      envVars: z.optional(z.string()).describe("Environment variables as JSON string (e.g. '{\"base_url\": \"...\", \"token\": \"...\"}')"),
    },
  }, async ({ name, specPath, dir, envVars }) => {
    try {
      let parsedEnvVars: Record<string, string> | undefined;
      if (envVars) {
        try {
          parsedEnvVars = JSON.parse(envVars);
        } catch {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "envVars must be a valid JSON string" }, null, 2) }],
            isError: true,
          };
        }
      }
      const result = await setupApi({
        name,
        spec: specPath,
        dir,
        envVars: parsedEnvVars,
        dbPath,
      });

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
