import { ErrorCode, McpError, type ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { McpServerContext } from "../server.ts";
import { RESOURCE_TEMPLATES, STATIC_RESOURCES, findStaticResource, matchTemplate } from "./registry.ts";

export function listResources() {
  return STATIC_RESOURCES.map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  }));
}

export function listResourceTemplates() {
  return RESOURCE_TEMPLATES.map((t) => ({
    uriTemplate: t.uriTemplate,
    name: t.name,
    description: t.description,
    mimeType: t.mimeType,
  }));
}

export async function readResource(uri: string, ctx: McpServerContext): Promise<ReadResourceResult> {
  const staticResource = findStaticResource(uri);
  if (staticResource) return staticResource.read(ctx);

  const matched = matchTemplate(uri);
  if (matched) return matched.template.read(matched.params, uri, ctx);

  throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
}
