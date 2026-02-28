import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { listEnvironmentRecords, getEnvironment, upsertEnvironment, deleteEnvironment } from "../../db/queries.ts";

export function registerManageEnvironmentTool(server: McpServer, dbPath?: string) {
  server.registerTool("manage_environment", {
    description: "Manage environments — list, get, set, or delete environment variables used for API test execution",
    inputSchema: {
      action: z.enum(["list", "get", "set", "delete"]).describe("Action: list, get, set, or delete"),
      name: z.optional(z.string()).describe("Environment name (required for get/set/delete)"),
      variables: z.optional(z.record(z.string(), z.string())).describe("Variables to set (for set action)"),
    },
  }, async ({ action, name, variables }) => {
    try {
      getDb(dbPath);

      switch (action) {
        case "list": {
          const envs = listEnvironmentRecords();
          const safe = envs.map(e => ({
            id: e.id,
            name: e.name,
            variables: Object.keys(e.variables),
          }));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(safe, null, 2) }],
          };
        }

        case "get": {
          if (!name) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "name is required for get action" }, null, 2) }],
              isError: true,
            };
          }
          const vars = getEnvironment(name);
          if (!vars) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: `Environment '${name}' not found` }, null, 2) }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ name, variables: vars }, null, 2) }],
          };
        }

        case "set": {
          if (!name || !variables) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "name and variables are required for set action" }, null, 2) }],
              isError: true,
            };
          }
          upsertEnvironment(name, variables);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, name }, null, 2) }],
          };
        }

        case "delete": {
          if (!name) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "name is required for delete action" }, null, 2) }],
              isError: true,
            };
          }
          const envs = listEnvironmentRecords();
          const env = envs.find(e => e.name === name);
          if (!env) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: `Environment '${name}' not found` }, null, 2) }],
              isError: true,
            };
          }
          deleteEnvironment(env.id);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: name }, null, 2) }],
          };
        }

        default:
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown action: ${action}` }, null, 2) }],
            isError: true,
          };
      }
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
