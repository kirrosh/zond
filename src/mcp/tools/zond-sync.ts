import { z } from "zod";

import {
  readOpenApiSpec,
  extractEndpoints,
} from "../../core/generator/index.ts";
import { decycleSchema } from "../../core/generator/schema-utils.ts";
import { filterByTag } from "../../core/generator/chunker.ts";
import { hashSpec, readMeta } from "../../core/meta/meta-store.ts";
import { diffEndpoints } from "../../core/sync/spec-differ.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  specPath: z.string().min(1),
  testsDir: z.string().min(1),
  tag: z.string().optional().describe("Limit diff to endpoints with this OpenAPI tag"),
});

type Input = z.infer<typeof inputSchema>;

export const zondSyncTool: McpTool<Input> = {
  name: "zond_sync",
  description: "Diff an OpenAPI spec against existing test metadata — returns new and removed endpoints (read-only, no file writes). Agents create new YAML test files via Write.",
  inputSchema,
  handler: async (input) => {
    const meta = await readMeta(input.testsDir);
    if (!meta) {
      throw new Error(
        "No .zond-meta.json found. Initialize tests via `zond generate <spec> --output <dir>` first.",
      );
    }
    const doc = await readOpenApiSpec(input.specPath);
    const specContent = JSON.stringify(decycleSchema(doc));
    const currentHash = hashSpec(specContent);
    const specChanged = currentHash !== meta.specHash;

    let currentEndpoints = extractEndpoints(doc);
    if (input.tag) currentEndpoints = filterByTag(currentEndpoints, input.tag);

    const prevKeys = Object.values(meta.files).flatMap((f) => f.endpoints);
    const { newEndpoints, removedKeys } = diffEndpoints(prevKeys, currentEndpoints);

    return {
      specChanged,
      newEndpoints: newEndpoints.map((ep) => ({ method: ep.method.toUpperCase(), path: ep.path })),
      removedKeys,
    };
  },
};
