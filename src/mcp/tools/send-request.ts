import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeRequest } from "../../core/runner/http-client.ts";
import { loadEnvironment, substituteString, substituteDeep } from "../../core/parser/variables.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

function extractByPath(obj: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(seg, 10);
      if (isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

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
      jsonPath: z.optional(z.string()).describe("Simple dot-notation path to extract from response body (e.g. '[0].code', 'data.items', 'id'). Supports array indices."),
      maxResponseChars: z.optional(z.number().int().positive()).describe("Truncate response body to this many characters"),
    },
  }, async ({ method, url, headers, body, timeout, envName, collectionName, jsonPath, maxResponseChars }) => {
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

      let responseBody: unknown = response.body_parsed ?? response.body;

      // Apply jsonPath filter
      if (jsonPath && responseBody !== undefined) {
        responseBody = extractByPath(responseBody, jsonPath);
      }

      const result = {
        status: response.status,
        headers: response.headers,
        body: responseBody,
        duration_ms: response.duration_ms,
      };

      let text = JSON.stringify(result, null, 2);

      // Apply maxResponseChars truncation
      if (maxResponseChars && text.length > maxResponseChars) {
        text = text.slice(0, maxResponseChars) + '\n…[truncated]';
      }

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
