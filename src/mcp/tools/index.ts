import type { McpTool } from "./types.ts";
import { zondRunTool } from "./zond-run.ts";
import { zondDiagnoseTool } from "./zond-diagnose.ts";

/**
 * Registry of all MCP tools exposed by `zond mcp start`.
 * Tools are added incrementally as TASK-6 lands; final 11-tool set is the goal.
 */
export const TOOL_REGISTRY: ReadonlyArray<McpTool<any, any>> = [
  zondRunTool,
  zondDiagnoseTool,
];

export type { McpTool } from "./types.ts";
