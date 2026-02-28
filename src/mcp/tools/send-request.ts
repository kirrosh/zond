import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeRequest } from "../../core/runner/http-client.ts";
import { loadEnvironment, substituteString, substituteDeep } from "../../core/parser/variables.ts";

export function registerSendRequestTool(server: McpServer) {
  server.registerTool("send_request", {
    description: "Send an ad-hoc HTTP request. Supports variable interpolation from environments (e.g. {{base_url}}).",
    inputSchema: {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).describe("HTTP method"),
      url: z.string().describe("Request URL (supports {{variable}} interpolation)"),
      headers: z.optional(z.record(z.string(), z.string())).describe("Request headers"),
      body: z.optional(z.string()).describe("Request body (JSON string)"),
      timeout: z.optional(z.number().int().positive()).describe("Request timeout in ms"),
      envName: z.optional(z.string()).describe("Environment name for variable interpolation"),
    },
  }, async ({ method, url, headers, body, timeout, envName }) => {
    try {
      const vars = await loadEnvironment(envName);

      const resolvedUrl = substituteString(url, vars) as string;
      const resolvedHeaders = headers ? substituteDeep(headers, vars) : {};
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
