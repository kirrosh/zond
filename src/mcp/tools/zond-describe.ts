import { z } from "zod";

import {
  describeEndpoint,
  describeCompact,
  describeAllParams,
} from "../../core/generator/describe.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  mode: z.enum(["endpoint", "compact", "params"]).describe(
    "endpoint: detail for one method+path; compact: list all endpoints; params: aggregated parameter index",
  ),
  specPath: z.string().min(1),
  method: z.string().optional().describe("Required when mode='endpoint'"),
  path: z.string().optional().describe("Required when mode='endpoint'"),
});

type Input = z.infer<typeof inputSchema>;

export const zondDescribeTool: McpTool<Input> = {
  name: "zond_describe",
  description: "Describe an OpenAPI spec — single endpoint detail (mode=endpoint), compact list of all endpoints (mode=compact), or aggregated parameter index (mode=params).",
  inputSchema,
  handler: async (input) => {
    if (input.mode === "endpoint") {
      if (!input.method || !input.path) {
        throw new Error("mode='endpoint' requires both method and path");
      }
      const result = await describeEndpoint(input.specPath, input.method, input.path);
      return result as unknown as Record<string, unknown>;
    }
    if (input.mode === "compact") {
      const endpoints = await describeCompact(input.specPath);
      return { endpoints };
    }
    const params = await describeAllParams(input.specPath);
    return { params };
  },
};
