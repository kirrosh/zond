/**
 * ARV-187 / lifecycle: parser + expected shape. No prompts inside zond.
 */

import { z } from "zod";
import type { ResourcePatch } from "./overlay.ts";
import type { ResourceSlice } from "./prompts.ts";

const ActionSchema = z.object({
  endpoint: z.string(),
  expected_state: z.string(),
  body: z.record(z.string(), z.unknown()).optional(),
});

const LifecycleSchema = z.object({
  field: z.string(),
  states: z.array(z.string()).min(2),
  transitions: z.array(z.object({ from: z.string(), to: z.array(z.string()) })),
  actions: z.record(z.string(), ActionSchema).default({}),
});

const ResponseSchema = z.object({
  resource: z.string(),
  lifecycle: LifecycleSchema.nullable(),
  rationale: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

export const EXPECTED_OUTPUT_SHAPE = {
  resource: "string (echo input)",
  lifecycle: {
    field: "string (response field holding state, e.g. 'status')",
    states: "string[] (≥2 enum values)",
    transitions: "[{from: state, to: state[]}]",
    actions: "{ <verb>: { endpoint: 'METHOD /path', expected_state: state, body?: object } } — return {} for read-only state machines (observation mode walks the list endpoint and asserts observed ⊆ states; cannot verify transitions in this mode)",
  },
  rationale: "string (optional)",
  confidence: "low | medium | high",
  null_form: "if no observable state machine, return { resource, lifecycle: null }",
};

export function parseLifecycleResponse(parsed: unknown, slice: ResourceSlice): { patch: ResourcePatch; audit: Record<string, unknown> } {
  const validated = ResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`lifecycle response failed schema for ${slice.resource}: ${validated.error.message}`);
  }
  const v = validated.data;
  if (v.lifecycle == null) {
    return {
      patch: { resource: slice.resource },
      audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence, dropped: "no state machine" },
    };
  }
  return {
    patch: {
      resource: slice.resource,
      lifecycle: {
        field: v.lifecycle.field,
        states: v.lifecycle.states,
        transitions: v.lifecycle.transitions,
        actions: Object.fromEntries(
          Object.entries(v.lifecycle.actions).map(([name, a]) => [name, {
            endpoint: a.endpoint,
            expected_state: a.expected_state,
            body: a.body,
          }]),
        ),
      },
    },
    audit: { resource: slice.resource, rationale: v.rationale, confidence: v.confidence },
  };
}

export function isApplicable(_slice: ResourceSlice): boolean { return true; }
