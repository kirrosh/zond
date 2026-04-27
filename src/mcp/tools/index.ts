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
import { zondInitTool } from "./zond-init.ts";
import { zondRequestTool } from "./zond-request.ts";

/**
 * Registry of all MCP tools exposed by `zond mcp start`. Each tool is a thin
 * wrapper over an existing src/core/* function; agents call them via MCP
 * `tools/call` instead of shelling out to `zond` and parsing stdout.
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
  zondInitTool,
  zondRequestTool,
];

export type { McpTool } from "./types.ts";
