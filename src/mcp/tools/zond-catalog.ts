import { z } from "zod";

import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  buildCatalog,
} from "../../core/generator/index.ts";
import { decycleSchema } from "../../core/generator/schema-utils.ts";
import { hashSpec } from "../../core/meta/meta-store.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  specPath: z.string().min(1),
  insecure: z.boolean().optional().describe("Skip TLS verification when fetching the spec"),
});

type Input = z.infer<typeof inputSchema>;

export const zondCatalogTool: McpTool<Input> = {
  name: "zond_catalog",
  description: "Build a compact API catalog from an OpenAPI spec — endpoints with parameters, request/response shapes, auth. Same data as `.api-catalog.yaml` but as a JSON object.",
  inputSchema,
  handler: async (input) => {
    const doc = await readOpenApiSpec(input.specPath, { insecure: input.insecure });
    const specContent = JSON.stringify(decycleSchema(doc));
    const specHash = hashSpec(specContent);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    const info = (doc as { info?: { title?: string; version?: string } }).info;
    const servers = (doc as { servers?: Array<{ url?: string }> }).servers;

    const catalog = buildCatalog({
      endpoints,
      securitySchemes,
      specSource: input.specPath,
      specHash,
      apiName: info?.title,
      apiVersion: info?.version,
      baseUrl: servers?.[0]?.url,
    });
    return catalog as unknown as Record<string, unknown>;
  },
};
