/**
 * ARV-187 / idempotency: parser + expected shape.
 */

import { z } from "zod";
import type { ResourcePatch } from "./overlay.ts";
import type { ResourceSlice } from "./prompts.ts";

const IdempotencySchema = z.object({
  header: z.string().default("Idempotency-Key"),
  scope: z.enum(["endpoint", "global"]).optional(),
  ignore_response_fields: z.array(z.string()).optional(),
});

const ResponseSchema = z.object({
  resource: z.string(),
  idempotency: IdempotencySchema.nullable(),
  rationale: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export const EXPECTED_OUTPUT_SHAPE = {
  resource: "string (echo input)",
  idempotency: {
    header: "string (header name, e.g. 'Idempotency-Key')",
    scope: "endpoint | global (optional)",
    ignore_response_fields: "string[] (optional — fields that change between replays, e.g. 'created')",
  },
  rationale: "string (optional)",
  confidence: "low | medium | high",
  null_form: "if create endpoint doesn't support idempotency-replay, return { resource, idempotency: null }",
};

export function parseIdempotencyResponse(parsed: unknown, slice: ResourceSlice): { patch: ResourcePatch; audit: Record<string, unknown> } {
  const validated = ResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`idempotency response failed schema for ${slice.resource}: ${validated.error.message}`);
  }
  const v = validated.data;
  if (v.idempotency == null) {
    return {
      patch: { resource: slice.resource },
      audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence, dropped: "no Idempotency-Key support" },
    };
  }
  return {
    patch: {
      resource: slice.resource,
      idempotency: {
        header: v.idempotency.header,
        scope: v.idempotency.scope,
        ignore_response_fields: v.idempotency.ignore_response_fields,
      },
    },
    audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence },
  };
}

export function isApplicable(slice: ResourceSlice): boolean { return Boolean(slice.endpoints.create); }
