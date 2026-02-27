import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../../db/schema.ts";
import { listRuns } from "../../db/queries.ts";

export function registerListRunsTool(server: McpServer, dbPath?: string) {
  server.registerTool("list_runs", {
    description: "List recent test runs with summary statistics",
    inputSchema: {
      limit: z.optional(z.number().int().min(1).max(100)).describe("Max number of runs to return (default: 20)"),
    },
  }, async ({ limit }) => {
    getDb(dbPath);
    const runs = listRuns(limit ?? 20);

    return {
      content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }],
    };
  });
}
