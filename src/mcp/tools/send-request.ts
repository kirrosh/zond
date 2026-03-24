import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sendAdHocRequest } from "../../core/runner/send-request.ts";
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
      jsonPath: z.optional(z.string()).describe("Simple dot-notation path to extract from response body (e.g. '[0].code', 'data.items', 'id'). Supports array indices."),
      maxResponseChars: z.optional(z.number().int().positive()).describe("Truncate response body to this many characters"),
    },
  }, async ({ method, url, headers, body, timeout, envName, collectionName, jsonPath, maxResponseChars }) => {
    try {
      const parsedHeaders = headers ? JSON.parse(headers) as Record<string, string> : undefined;

      const result = await sendAdHocRequest({
        method,
        url,
        headers: parsedHeaders,
        body: body ?? undefined,
        timeout,
        envName,
        collectionName,
        jsonPath,
        dbPath,
      });

      let text = JSON.stringify(result, null, 2);
      if (maxResponseChars && text.length > maxResponseChars) {
        text = text.slice(0, maxResponseChars) + '\n\u2026[truncated]';
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
