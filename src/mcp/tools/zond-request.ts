import { z } from "zod";

import { sendAdHocRequest } from "../../core/runner/send-request.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  method: z.string().min(1).describe("HTTP method (GET, POST, ...)"),
  url: z.string().min(1).describe("Full URL or path with {{var}} interpolation"),
  headers: z.record(z.string(), z.string()).optional().describe("Request headers (Name: Value)"),
  body: z.string().optional().describe("Request body (raw string; JSON Content-Type auto-detected)"),
  timeout: z.number().int().positive().optional(),
  envName: z.string().optional().describe("Environment file name for {{var}} interpolation"),
  collectionName: z.string().optional().describe("API collection name (loads its env)"),
  jsonPath: z.string().optional().describe("Extract one value from response (dot/index notation)"),
});

type Input = z.infer<typeof inputSchema>;

export const zondRequestTool: McpTool<Input> = {
  name: "zond_request",
  description: "Send a single ad-hoc HTTP request with env-variable interpolation. Returns status, headers, body, duration_ms.",
  inputSchema,
  handler: async (input, ctx) => {
    const result = await sendAdHocRequest({
      method: input.method.toUpperCase(),
      url: input.url,
      headers: input.headers,
      body: input.body,
      timeout: input.timeout,
      envName: input.envName,
      collectionName: input.collectionName,
      jsonPath: input.jsonPath,
      dbPath: ctx.dbPath,
    });
    return result as unknown as Record<string, unknown>;
  },
};
