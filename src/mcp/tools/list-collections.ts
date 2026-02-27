import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { listCollections } from "../../db/queries.ts";

export function registerListCollectionsTool(server: McpServer, dbPath?: string) {
  server.registerTool("list_collections", {
    description: "List all test collections with their run statistics",
  }, async () => {
    getDb(dbPath);
    const collections = listCollections();

    return {
      content: [{ type: "text" as const, text: JSON.stringify(collections, null, 2) }],
    };
  });
}
