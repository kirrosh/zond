import { tool } from "ai";
import { z } from "zod";
import { executeRequest } from "../../runner/http-client.ts";
import { loadEnvironment, substituteString, substituteDeep } from "../../parser/variables.ts";

export const sendRequestTool = tool({
  description: "Send an ad-hoc HTTP request. Supports variable interpolation from environments (e.g. {{base_url}}).",
  inputSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).describe("HTTP method"),
    url: z.string().describe("Request URL (supports {{variable}} interpolation)"),
    headers: z.record(z.string(), z.string()).optional().describe("Request headers"),
    body: z.string().optional().describe("Request body (JSON string)"),
    timeout: z.number().int().positive().optional().describe("Request timeout in ms"),
    envName: z.string().optional().describe("Environment name for variable interpolation"),
  }),
  execute: async (args) => {
    try {
      const vars = await loadEnvironment(args.envName);

      const resolvedUrl = substituteString(args.url, vars) as string;
      const resolvedHeaders = args.headers ? substituteDeep(args.headers, vars) : {};
      const resolvedBody = args.body ? substituteString(args.body, vars) as string : undefined;

      const response = await executeRequest(
        {
          method: args.method,
          url: resolvedUrl,
          headers: resolvedHeaders,
          body: resolvedBody,
        },
        args.timeout ? { timeout: args.timeout } : undefined,
      );

      // Compact output for agent — skip response headers
      return {
        status: response.status,
        body: response.body_parsed ?? response.body,
        duration_ms: response.duration_ms,
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
});
