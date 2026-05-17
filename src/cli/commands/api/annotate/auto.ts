/**
 * ARV-262: heuristic inference for the annotate overlay.
 *
 * `zond api annotate auto` walks each resource slice and applies safe,
 * conservative pattern-matches to infer `pagination`, `lifecycle`, and
 * `idempotency` blocks without an agent in the loop. Designed for
 * large APIs (e.g. GitHub 1184-endpoint) where hand-writing a YAML
 * overlay per resource per aspect is impractical.
 *
 * Confidence is intentionally narrow: each inferrer produces only
 * `high`-confidence patches (clean spec signals) or returns null.
 * Ambiguous cases stay null and require the agent overlay path.
 */

import type { ResourcePatch } from "./overlay.ts";
import type { ResourceSlice, EndpointDump } from "./prompts.ts";

export type Aspect = "pagination" | "lifecycle" | "idempotency";
export type Confidence = "high" | "medium" | "low";

export interface AutoInference {
  resource: string;
  aspect: Aspect;
  confidence: Confidence;
  rationale: string;
  patch: ResourcePatch;
}

// ─── Pagination ──────────────────────────────────────────────────────

const PAGE_PARAMS = ["page"];
const LIMIT_PARAMS = ["per_page", "page_size", "pagesize", "limit"];
const CURSOR_PARAMS = ["cursor", "starting_after", "after", "page_token"];

export function inferPagination(slice: ResourceSlice): AutoInference | null {
  const list = slice.endpoints.list;
  if (!list || !list.parameters) return null;

  const queryByName = new Map<string, string>();
  for (const p of list.parameters) {
    if (p.in === "query") queryByName.set(p.name.toLowerCase(), p.name);
  }

  const pageOrig = pickOriginal(queryByName, PAGE_PARAMS);
  const limitOrig = pickOriginal(queryByName, LIMIT_PARAMS);
  if (pageOrig && limitOrig) {
    return {
      resource: slice.resource,
      aspect: "pagination",
      confidence: "high",
      rationale: `list endpoint declares ${pageOrig}+${limitOrig} → page-style`,
      patch: {
        resource: slice.resource,
        pagination: {
          type: "page",
          page_param: pageOrig,
          limit_param: limitOrig,
          items_field: detectItemsField(list),
        },
      },
    };
  }

  const cursorOrig = pickOriginal(queryByName, CURSOR_PARAMS);
  if (cursorOrig) {
    const hasMore = detectHasMoreField(list);
    const itemsField = detectItemsField(list);
    const pag: Record<string, unknown> = {
      type: "cursor",
      cursor_param: cursorOrig,
    };
    if (hasMore) pag.has_more_field = hasMore;
    if (itemsField) pag.items_field = itemsField;
    return {
      resource: slice.resource,
      aspect: "pagination",
      confidence: "high",
      rationale: `list endpoint declares ${cursorOrig} → cursor-style`,
      patch: { resource: slice.resource, pagination: pag as ResourcePatch["pagination"] },
    };
  }

  return null;
}

function pickOriginal(byLower: Map<string, string>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const orig = byLower.get(c);
    if (orig) return orig;
  }
  return undefined;
}

function detectItemsField(ep: EndpointDump): string | undefined {
  const schema = ok200Schema(ep);
  if (!schema) return undefined;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props) return undefined;
  for (const [name, val] of Object.entries(props)) {
    const v = val as { type?: string };
    if (v && v.type === "array") return name;
  }
  return undefined;
}

function detectHasMoreField(ep: EndpointDump): string | undefined {
  const schema = ok200Schema(ep);
  if (!schema) return undefined;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props) return undefined;
  for (const [name, val] of Object.entries(props)) {
    const v = val as { type?: string };
    if (!v || v.type !== "boolean") continue;
    const lower = name.toLowerCase();
    if (lower === "has_more" || lower === "hasmore" || lower === "more") return name;
  }
  return undefined;
}

function ok200Schema(ep: EndpointDump): unknown {
  const r = ep.responses;
  if (!r) return undefined;
  return r["200"]?.schema ?? r["201"]?.schema ?? Object.values(r)[0]?.schema;
}

// ─── Lifecycle (observation mode) ────────────────────────────────────

const STATE_FIELD_NAMES = ["status", "state"];

export function inferLifecycle(slice: ResourceSlice): AutoInference | null {
  const ep = slice.endpoints.read ?? slice.endpoints.list ?? slice.endpoints.create;
  if (!ep) return null;
  const schema = ok200Schema(ep);
  if (!schema) return null;
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props) return null;

  for (const candidate of STATE_FIELD_NAMES) {
    const found = findCaseInsensitive(props, candidate);
    if (!found) continue;
    const fieldSchema = found.value as { type?: string; enum?: unknown[] };
    if (!fieldSchema || !Array.isArray(fieldSchema.enum)) continue;
    const states = fieldSchema.enum.filter((s): s is string => typeof s === "string");
    if (states.length < 2) continue;
    return {
      resource: slice.resource,
      aspect: "lifecycle",
      confidence: "high",
      rationale: `response schema has ${found.name} enum with ${states.length} states (observation mode)`,
      patch: {
        resource: slice.resource,
        lifecycle: {
          field: found.name,
          states,
          transitions: [],
          actions: {},
        },
      },
    };
  }
  return null;
}

function findCaseInsensitive(
  props: Record<string, unknown>,
  needle: string,
): { name: string; value: unknown } | null {
  const lower = needle.toLowerCase();
  for (const [k, v] of Object.entries(props)) {
    if (k.toLowerCase() === lower) return { name: k, value: v };
  }
  return null;
}

// ─── Idempotency ─────────────────────────────────────────────────────

export function inferIdempotency(slice: ResourceSlice): AutoInference | null {
  const create = slice.endpoints.create;
  if (!create || !create.parameters) return null;
  for (const p of create.parameters) {
    if (p.in !== "header") continue;
    const lower = p.name.toLowerCase();
    if (lower.includes("idempotency")) {
      return {
        resource: slice.resource,
        aspect: "idempotency",
        confidence: "high",
        rationale: `create endpoint declares header ${p.name}`,
        patch: {
          resource: slice.resource,
          idempotency: { header: p.name },
        },
      };
    }
  }
  return null;
}

// ─── Orchestration ───────────────────────────────────────────────────

export function inferForAspect(aspect: Aspect, slice: ResourceSlice): AutoInference | null {
  switch (aspect) {
    case "pagination": return inferPagination(slice);
    case "lifecycle":  return inferLifecycle(slice);
    case "idempotency": return inferIdempotency(slice);
  }
}

export function inferAll(slices: ResourceSlice[], aspects: Aspect[]): AutoInference[] {
  const out: AutoInference[] = [];
  for (const slice of slices) {
    for (const aspect of aspects) {
      const inf = inferForAspect(aspect, slice);
      if (inf) out.push(inf);
    }
  }
  return out;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function meetsConfidence(have: Confidence, want: Confidence): boolean {
  return CONFIDENCE_RANK[have] >= CONFIDENCE_RANK[want];
}
