import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeRequest } from "../../core/runner/http-client.ts";
import { loadEnvironment, substituteString, substituteDeep } from "../../core/parser/variables.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

export function registerSendRequestTool(server: McpServer, dbPath?: string) {
  server.registerTool("send_request", {
    description: TOOL_DESCRIPTIONS.send_request,
    inputSchema: {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).describe("HTTP method"),
      url: z.string().describe("Request URL (supports {{variable}} interpolation)"),
      headers: z.optional(z.string()).describe("Request headers as JSON string (e.g. '{\"Content-Type\": \"application/json\"}')"),
      body: z.optional(z.string()).describe("Request body (JSON string)"),
      timeout: z.optional(z.number().int().positive()).describe("Request timeout in ms"),
      envName: z.optional(z.string()).describe("Environment name for variable interpolation"),
      collectionName: z.optional(z.string()).describe("Collection name to load env from its base_dir (e.g. 'petstore'). Required for {{variable}} interpolation."),
    },
  }, async ({ method, url, headers, body, timeout, envName, collectionName }) => {
    try {
      let searchDir = process.cwd();
      if (collectionName) {
        getDb(dbPath);
        const col = findCollectionByNameOrId(collectionName);
        if (col?.base_dir) searchDir = col.base_dir;
      }
      const vars = await loadEnvironment(envName, searchDir);

      const resolvedUrl = substituteString(url, vars) as string;
      const parsedHeaders = headers ? JSON.parse(headers) as Record<string, string> : {};
      const resolvedHeaders = Object.keys(parsedHeaders).length > 0 ? substituteDeep(parsedHeaders, vars) : {};
      const resolvedBody = body ? substituteString(body, vars) as string : undefined;

      const response = await executeRequest(
        {
          method,
          url: resolvedUrl,
          headers: resolvedHeaders,
          body: resolvedBody,
        },
        timeout ? { timeout } : undefined,
      );

      const result = {
        status: response.status,
        headers: response.headers,
        body: response.body_parsed ?? response.body,
        duration_ms: response.duration_ms,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
