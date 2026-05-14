/**
 * ARV-187 / resources: parser + expected shape for orphan-clustering.
 */

import { z } from "zod";
import type { ResourceYaml } from "../../discover.ts";

const EndpointMapSchema = z.object({
  list: z.string().optional(),
  create: z.string().optional(),
  read: z.string().optional(),
  update: z.string().optional(),
  delete: z.string().optional(),
});

const FkSchema = z.object({
  var: z.string(),
  param: z.string(),
  in: z.enum(["path", "body"]),
  ownerResource: z.string().nullable(),
});

const ExtensionSchema = z.object({
  resource: z.string(),
  basePath: z.string(),
  itemPath: z.string(),
  idParam: z.string(),
  captureField: z.string().optional(),
  hasFullCrud: z.boolean().optional(),
  endpoints: EndpointMapSchema,
  fkDependencies: z.array(FkSchema).default([]),
  confidence: z.enum(["low", "medium", "high"]),
  rationale: z.string().optional(),
});

const ResponseSchema = z.object({
  extensions: z.array(ExtensionSchema).default([]),
  rationale: z.string().optional(),
});

export const EXPECTED_OUTPUT_SHAPE = {
  extensions: [{
    resource: "slug",
    basePath: "/v1/<collection>",
    itemPath: "/v1/<collection>/{<id_param>}",
    idParam: "string",
    captureField: "string (optional, default 'id')",
    hasFullCrud: "boolean (optional)",
    endpoints: { list: "GET /...", create: "POST /...", read: "GET /...", update: "PATCH /...", delete: "DELETE /..." },
    fkDependencies: "FkRef[] (usually [])",
    confidence: "low | medium | high (only 'high' is accepted by zond)",
    rationale: "string (optional)",
  }],
  rationale: "string (optional)",
};

export interface ResourcesParseResult {
  extensions: ResourceYaml[];
  audit: {
    proposed: number;
    droppedLowConfidence: number;
    rationale?: string;
  };
}

export function parseResourcesResponse(parsed: unknown): ResourcesParseResult {
  const validated = ResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`resources response failed schema: ${validated.error.message}`);
  }
  const v = validated.data;
  let dropped = 0;
  const extensions: ResourceYaml[] = [];
  for (const ext of v.extensions) {
    if (ext.confidence !== "high") { dropped++; continue; }
    extensions.push({
      resource: ext.resource,
      basePath: ext.basePath,
      itemPath: ext.itemPath,
      idParam: ext.idParam,
      captureField: ext.captureField,
      hasFullCrud: ext.hasFullCrud,
      endpoints: ext.endpoints,
      fkDependencies: ext.fkDependencies,
    });
  }
  return {
    extensions,
    audit: { proposed: v.extensions.length, droppedLowConfidence: dropped, rationale: v.rationale },
  };
}
