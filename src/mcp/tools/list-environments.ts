import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { listEnvironmentRecords } from "../../db/queries.ts";

export function registerListEnvironmentsTool(server: McpServer, dbPath?: string) {
  server.registerTool("list_environments", {
    description: "List all saved environments with their variable names (values hidden for security)",
  }, async () => {
    getDb(dbPath);
    const envs = listEnvironmentRecords();

    const safe = envs.map(e => ({
      id: e.id,
      name: e.name,
      variables: Object.keys(e.variables),
    }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify(safe, null, 2) }],
    };
  });
}
