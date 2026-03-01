import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { listEnvironmentRecords, getEnvironment, upsertEnvironment, deleteEnvironment, findCollectionByNameOrId } from "../../db/queries.ts";

export function registerManageEnvironmentTool(server: McpServer, dbPath?: string) {
  server.registerTool("manage_environment", {
    description: "Manage environments — list, get, set, or delete environment variables used for API test execution. Use collectionName to scope environments to a specific API.",
    inputSchema: {
      action: z.enum(["list", "get", "set", "delete"]).describe("Action: list, get, set, or delete"),
      name: z.optional(z.string()).describe("Environment name (required for get/set/delete)"),
      variables: z.optional(z.record(z.string(), z.string())).describe("Variables to set (for set action)"),
      collectionName: z.optional(z.string()).describe("API/collection name or ID to scope the environment to"),
    },
  }, async ({ action, name, variables, collectionName }) => {
    try {
      getDb(dbPath);

      // Resolve collection if provided
      let collectionId: number | undefined;
      if (collectionName) {
        const col = findCollectionByNameOrId(collectionName);
        if (!col) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `API '${collectionName}' not found` }, null, 2) }],
            isError: true,
          };
        }
        collectionId = col.id;
      }

      switch (action) {
        case "list": {
          const envs = listEnvironmentRecords(collectionId);
          const safe = envs.map(e => ({
            id: e.id,
            name: e.name,
            collection_id: e.collection_id,
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
          const vars = getEnvironment(name, collectionId);
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
          upsertEnvironment(name, variables, collectionId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, name, collection_id: collectionId ?? null }, null, 2) }],
          };
        }

        case "delete": {
          if (!name) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "name is required for delete action" }, null, 2) }],
              isError: true,
            };
          }
          const envs = listEnvironmentRecords(collectionId);
          const env = collectionId
            ? envs.find(e => e.name === name && e.collection_id === collectionId)
            : envs.find(e => e.name === name && e.collection_id === null);
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
