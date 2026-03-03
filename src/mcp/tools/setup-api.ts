import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { setupApi } from "../../core/setup-api.ts";
import { resetDb } from "../../db/schema.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

function findProjectRoot(fromPath: string): string | null {
  let current = existsSync(fromPath) ? fromPath : dirname(fromPath);
  while (true) {
    if (existsSync(join(current, ".git")) || existsSync(join(current, "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function registerSetupApiTool(server: McpServer, dbPath?: string) {
  server.registerTool("setup_api", {
    description: TOOL_DESCRIPTIONS.setup_api,
    inputSchema: {
      name: z.string().describe("API name (e.g. 'petstore')"),
      specPath: z.optional(z.string()).describe("Path or URL to OpenAPI spec"),
      dir: z.optional(z.string()).describe("Base directory (default: ./apis/<name>/)"),
      envVars: z.optional(z.string()).describe("Environment variables as JSON string (e.g. '{\"base_url\": \"...\", \"token\": \"...\"}')"),
      force: z.optional(z.boolean()).describe("If true, delete existing API with same name and recreate from scratch"),
    },
  }, async ({ name, specPath, dir, envVars, force }) => {
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

      // Auto-chdir to project root when dir is an absolute path
      if (dir && isAbsolute(resolve(dir))) {
        const resolvedDir = resolve(dir);
        const root = findProjectRoot(resolvedDir);
        if (root && root !== process.cwd()) {
          process.chdir(root);
          resetDb();
        }
      }

      const result = await setupApi({
        name,
        spec: specPath,
        dir,
        envVars: parsedEnvVars,
        dbPath,
        force,
      });

      const envFilePath = join(result.baseDir, ".env.yaml");
      const response = {
        ...result,
        nextSteps: [
          `Edit ${envFilePath} to add credentials (auth_token, api_key, base_url, etc.)`,
          `File is already git-ignored via .gitignore`,
          `Then run: run_tests(testPath: "${result.testPath}")`,
        ],
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
