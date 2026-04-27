import { z } from "zod";

import { setupApi } from "../../core/setup-api.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  name: z.string().optional().describe("API collection name (auto-derived from spec title if omitted)"),
  spec: z.string().optional().describe("Path or URL to the OpenAPI spec"),
  dir: z.string().optional().describe("Target directory for tests (default: collection name)"),
  envVars: z.record(z.string(), z.string()).optional().describe("Initial env values (e.g. base_url override)"),
  force: z.boolean().optional().describe("Replace an existing collection with the same name"),
  insecure: z.boolean().optional().describe("Skip TLS verification when fetching the spec"),
});

type Input = z.infer<typeof inputSchema>;

export const zondInitTool: McpTool<Input> = {
  name: "zond_init",
  description: "Register a new API collection in the zond DB and scaffold its test directory + .env.yaml. Returns the created collection metadata.",
  inputSchema,
  handler: async (input, ctx) => {
    const result = await setupApi({
      name: input.name,
      spec: input.spec,
      dir: input.dir,
      envVars: input.envVars,
      force: input.force,
      insecure: input.insecure,
      dbPath: ctx.dbPath,
    });
    return result as unknown as Record<string, unknown>;
  },
};
