import type { McpTool } from "./types.ts";
import { zondRunTool } from "./zond-run.ts";
import { zondDiagnoseTool } from "./zond-diagnose.ts";
import { zondDbRunsTool } from "./zond-db-runs.ts";
import { zondDbRunTool } from "./zond-db-run.ts";
import { zondDescribeTool } from "./zond-describe.ts";
import { zondCatalogTool } from "./zond-catalog.ts";
import { zondCoverageTool } from "./zond-coverage.ts";
import { zondValidateTool } from "./zond-validate.ts";
import { zondSyncTool } from "./zond-sync.ts";

/**
 * Registry of all MCP tools exposed by `zond mcp start`.
 * Tools are added incrementally as TASK-6 lands; final 11-tool set is the goal.
 */
export const TOOL_REGISTRY: ReadonlyArray<McpTool<any, any>> = [
  zondRunTool,
  zondDiagnoseTool,
  zondDbRunsTool,
  zondDbRunTool,
  zondDescribeTool,
  zondCatalogTool,
  zondCoverageTool,
  zondValidateTool,
  zondSyncTool,
];

export type { McpTool } from "./types.ts";
