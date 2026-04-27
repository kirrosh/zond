import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { VERSION } from "../cli/version.ts";
import { TOOL_REGISTRY } from "./tools/index.ts";

// IMPORTANT: stdio transport uses stdout for JSON-RPC. Never write to stdout
// from this module, its handlers, or anything imported during MCP requests.
// Use process.stderr / printError() if logging is needed.

export interface McpServerContext {
  /** Path to SQLite DB. Tools read from here via closure. */
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_REGISTRY.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = TOOL_REGISTRY.find((t) => t.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }

    const parsed = tool.inputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Invalid input for ${name}: ${JSON.stringify(parsed.error.issues)}`,
        }],
      };
    }

    try {
      const result = await tool.handler(parsed.data, ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `Tool ${name} failed: ${message}` }],
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  return server;
}

export async function startMcpServer(options: StartMcpServerOptions): Promise<void> {
  const server = buildMcpServer({ dbPath: options.dbPath });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
