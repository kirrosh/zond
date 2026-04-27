import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { McpServerContext } from "../server.ts";

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read(ctx: McpServerContext): Promise<ReadResourceResult> | ReadResourceResult;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
  match(uri: string): Record<string, string> | null;
  read(
    params: Record<string, string>,
    uri: string,
    ctx: McpServerContext,
  ): Promise<ReadResourceResult> | ReadResourceResult;
}
