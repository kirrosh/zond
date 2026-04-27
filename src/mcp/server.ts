import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { VERSION } from "../cli/version.ts";

// IMPORTANT: stdio transport uses stdout for JSON-RPC. Never write to stdout
// from this module, its handlers, or anything imported during MCP requests.
// Use process.stderr / printError() if logging is needed.

export interface McpServerContext {
  /** Path to SQLite DB. T6 tools will read from here via closure. */
  dbPath?: string;
}

export interface StartMcpServerOptions extends McpServerContext {
  /** Reserved for future transports; currently always stdio. */
  stdio?: boolean;
}

export function buildMcpServer(ctx: McpServerContext): Server {
  const server = new Server(
    { name: "zond", version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  void ctx;
  return server;
}

export async function startMcpServer(options: StartMcpServerOptions): Promise<void> {
  const server = buildMcpServer({ dbPath: options.dbPath });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
