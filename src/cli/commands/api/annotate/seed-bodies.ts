/**
 * ARV-187 / seed-bodies: parser + schema-shape. zond does NOT
 * formulate prompts — that's the agent's job. zond exposes the spec
 * slice and the expected response shape; the agent decides how to ask
 * its LLM.
 */

import { z } from "zod";
import type { ResourcePatch } from "./overlay.ts";
import type { ResourceSlice } from "./prompts.ts";

const SeedBodySchema = z.object({
  content_type: z.string().optional(),
  body: z.record(z.string(), z.unknown()),
});

const ResponseSchema = z.object({
  resource: z.string(),
  seed_body: SeedBodySchema.nullable(),
  rationale: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export const EXPECTED_OUTPUT_SHAPE = {
  resource: "string (echo input)",
  seed_body: {
    content_type: "string (optional; defaults to spec's requestBodyContentType)",
    body: "object (minimal-required field-set the create endpoint accepts)",
  },
  rationale: "string (optional, one sentence)",
  confidence: "low | medium | high",
  null_form: "if endpoint cannot be seeded statically, return { resource, seed_body: null, rationale }",
};

export function parseSeedBodyResponse(parsedYaml: unknown, slice: ResourceSlice): { patch: ResourcePatch; audit: Record<string, unknown> } {
  const validated = ResponseSchema.safeParse(parsedYaml);
  if (!validated.success) {
    throw new Error(`seed_body response failed schema for ${slice.resource}: ${validated.error.message}`);
  }
  const v = validated.data;
  if (v.seed_body == null) {
    return {
      patch: { resource: slice.resource },
      audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence, dropped: "agent judged endpoint not seedable" },
    };
  }
  return {
    patch: {
      resource: slice.resource,
      seed_body: {
        content_type: v.seed_body.content_type ?? slice.endpoints.create?.requestBody?.contentType,
        body: v.seed_body.body,
      },
    },
    audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence },
  };
}

export function isApplicable(slice: ResourceSlice): boolean {
  return Boolean(slice.endpoints.create);
}
