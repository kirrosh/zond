import type { z } from "zod";

import type { McpServerContext } from "../server.ts";

/**
 * Contract for a single MCP tool. Each tool owns its Zod input schema and a
 * pure handler that delegates to existing src/core/* functions. The registry
 * (./index.ts) collects them; the server (../server.ts) wires them into MCP
 * `tools/list` and `tools/call` request handlers.
 */
export interface McpTool<I = unknown, O extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  handler: (input: I, ctx: McpServerContext) => Promise<O> | O;
}
