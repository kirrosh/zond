/**
 * ARV-187 / readback: parser + expected shape.
 */

import { z } from "zod";
import type { ResourcePatch } from "./overlay.ts";
import type { ResourceSlice } from "./prompts.ts";

const ReadbackSchema = z.object({
  ignore_fields: z.array(z.string()).default([]),
  write_to_read_map: z.record(z.string(), z.string()).default({}),
});

const ResponseSchema = z.object({
  resource: z.string(),
  readback_diff: ReadbackSchema.nullable(),
  rationale: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export const EXPECTED_OUTPUT_SHAPE = {
  resource: "string (echo input)",
  readback_diff: {
    ignore_fields: "string[] (write-only fields cross_call_references should ignore)",
    write_to_read_map: "{ <write_field>: <read_field> } (renames on the read shape)",
  },
  rationale: "string (optional)",
  confidence: "low | medium | high",
  null_form: "if read shape echoes write shape, return { resource, readback_diff: null }",
};

export function parseReadbackResponse(parsed: unknown, slice: ResourceSlice): { patch: ResourcePatch; audit: Record<string, unknown> } {
  const validated = ResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`readback response failed schema for ${slice.resource}: ${validated.error.message}`);
  }
  const v = validated.data;
  if (v.readback_diff == null) {
    return {
      patch: { resource: slice.resource },
      audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence, dropped: "no drift expected" },
    };
  }
  if ((v.readback_diff.ignore_fields?.length ?? 0) === 0 && Object.keys(v.readback_diff.write_to_read_map ?? {}).length === 0) {
    return {
      patch: { resource: slice.resource },
      audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence, dropped: "empty readback hints" },
    };
  }
  return {
    patch: { resource: slice.resource, readback_diff: v.readback_diff },
    audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence },
  };
}

export function isApplicable(slice: ResourceSlice): boolean {
  return Boolean(slice.endpoints.create && slice.endpoints.read);
}
