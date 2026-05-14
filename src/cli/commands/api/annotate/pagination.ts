/**
 * ARV-187 / pagination: parser + expected shape.
 */

import { z } from "zod";
import type { ResourcePatch } from "./overlay.ts";
import type { ResourceSlice } from "./prompts.ts";

const PaginationSchema = z.object({
  type: z.enum(["cursor", "page", "offset", "token"]),
  cursor_param: z.string().optional(),
  cursor_field: z.string().optional(),
  has_more_field: z.string().optional(),
  limit_param: z.string().optional(),
  default_limit: z.number().int().positive().optional(),
  items_field: z.string().optional(),
});

const ResponseSchema = z.object({
  resource: z.string(),
  pagination: PaginationSchema.nullable(),
  rationale: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export const EXPECTED_OUTPUT_SHAPE = {
  resource: "string (echo input)",
  pagination: {
    type: "cursor | page | offset | token",
    cursor_param: "string (optional — query param carrying cursor value)",
    cursor_field: "string (optional — response field that becomes next cursor)",
    has_more_field: "string (optional — boolean response field signalling more)",
    limit_param: "string (optional)",
    default_limit: "integer (optional)",
    items_field: "string (optional — response field carrying array)",
  },
  rationale: "string (optional)",
  confidence: "low | medium | high",
  null_form: "if list endpoint doesn't paginate, return { resource, pagination: null }",
};

export function parsePaginationResponse(parsed: unknown, slice: ResourceSlice): { patch: ResourcePatch; audit: Record<string, unknown> } {
  const validated = ResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`pagination response failed schema for ${slice.resource}: ${validated.error.message}`);
  }
  const v = validated.data;
  if (v.pagination == null) {
    return {
      patch: { resource: slice.resource },
      audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence, dropped: "endpoint does not paginate" },
    };
  }
  return {
    patch: { resource: slice.resource, pagination: v.pagination },
    audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence },
  };
}

export function isApplicable(slice: ResourceSlice): boolean { return Boolean(slice.endpoints.list); }
