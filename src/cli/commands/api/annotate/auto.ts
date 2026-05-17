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

export type Aspect = "pagination" | "lifecycle" | "idempotency" | "seed-bodies";
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

// ─── Seed-bodies (ARV-270) ───────────────────────────────────────────

/** Trailing FK markers we'll strip when matching env-var stems
 *  (`customer_id` in `required` → look up `customer_id` then `customer`
 *  in `.env.yaml`). Keep in sync with discover.ts:VAR_SUFFIX_HINTS. */
const FK_SUFFIX_RE = /(_id|_uuid|_slug|_key|_token|_ref)$/;

/**
 * Heuristic seed_body generator. Walks the create-endpoint request
 * schema's `required` field set, fills each entry with a deterministic
 * default (format-aware → name-aware → type default) or with an
 * `{{var}}` template when `.env.yaml` already holds a matching FK.
 *
 * Returns null when the schema is too complex for safe heuristic:
 *   - nested objects with their own `required` keys
 *   - oneOf / anyOf unions (discriminator XORs)
 *   - required fields whose type we can't fabricate (e.g. binary)
 *
 * Those cases stay for the agent-loop (ARV-187 dump+apply) — the AC
 * gate is "covers the typical RESTful resource", not "covers every
 * exotic Stripe XOR".
 */
export function inferSeedBody(
  slice: ResourceSlice,
  env: Record<string, string> = {},
): AutoInference | null {
  const create = slice.endpoints.create;
  if (!create) return null;
  const rb = create.requestBody;
  if (!rb || !rb.schema || typeof rb.schema !== "object") return null;
  const schema = rb.schema as Record<string, unknown>;
  // simplifySchema collapses oneOf/anyOf to *_first siblings; presence
  // signals a discriminator union we can't disambiguate without the LLM.
  if (schema.oneOf_first || schema.anyOf_first) return null;
  const required = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  if (required.length === 0) return null;
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return null;

  const body: Record<string, unknown> = {};
  let envHits = 0;
  for (const field of required) {
    const fieldSchema = props[field];
    if (!fieldSchema) return null;
    // Drop nested objects whose own `required` set we'd have to fill.
    // Top-level overlays don't recurse — leave to agent-loop.
    if (
      fieldSchema.type === "object"
      && Array.isArray(fieldSchema.required as unknown[])
      && (fieldSchema.required as unknown[]).length > 0
    ) {
      return null;
    }
    if (fieldSchema.oneOf_first || fieldSchema.anyOf_first) return null;
    const picked = pickSeedValue(field, fieldSchema, env);
    if (picked === undefined) return null;
    body[field] = picked.value;
    if (picked.source === "env") envHits++;
  }

  // `high` only when every required field hit either an enum/format
  // signal or env-FK substitution. When we leaned on the generic
  // `zond-probe-<name>` fallback (no format, no name hit) drop to
  // `medium` so users can opt-in via `--confidence medium`.
  const usedFallback = required.some((f) => {
    const ps = props[f]!;
    const v = pickSeedValue(f, ps, env);
    return v?.source === "fallback";
  });
  const confidence: Confidence = usedFallback ? "medium" : "high";

  return {
    resource: slice.resource,
    aspect: "seed-bodies",
    confidence,
    rationale: `${required.length} required field(s) filled heuristically${envHits > 0 ? ` (${envHits} FK from env)` : ""}${usedFallback ? "; some via generic fallback" : ""}`,
    patch: {
      resource: slice.resource,
      seed_body: {
        content_type: rb.contentType,
        body,
      },
    },
  };
}

interface SeedValue {
  value: unknown;
  /** `enum`/`format`/`name`/`env`/`type` — drives confidence ranking. */
  source: "enum" | "format" | "name" | "env" | "type" | "fallback";
}

function pickSeedValue(
  name: string,
  schema: Record<string, unknown>,
  env: Record<string, string>,
): SeedValue | undefined {
  // 1. enum → first declared value. Strongest signal: the server has
  //    spelt out exactly what it will accept.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return { value: schema.enum[0], source: "enum" };
  }
  // 2. FK lookup — exact field name in env, then `<field>_id`, then
  //    stem (`customer_id` → env["customer"]). Lets prepare-fixtures
  //    feed agent-bootstrapped ids into the seed POST instead of
  //    random scalars that strict APIs reject.
  const fkVar = pickEnvVar(name, env);
  if (fkVar) return { value: `{{${fkVar}}}`, source: "env" };

  const type = (schema.type as string | undefined) ?? "string";
  const format = schema.format as string | undefined;

  // 3. Format-aware string defaults (AC #2).
  if (type === "string") {
    if (format === "email" || /^email$|_email$/i.test(name)) {
      return { value: "zond-probe@example.com", source: format ? "format" : "name" };
    }
    if (format === "uri" || format === "url" || /^(url|uri|webhook|callback)$|_url$|_uri$/i.test(name)) {
      return { value: "https://example.com/zond-probe", source: format ? "format" : "name" };
    }
    if (format === "date-time") return { value: "2025-01-01T00:00:00Z", source: "format" };
    if (format === "date") return { value: "2025-01-01", source: "format" };
    if (format === "uuid") return { value: "00000000-0000-0000-0000-000000000000", source: "format" };
    // ARV-165 cascade: name-based hints for ISO literals strict
    // validators check (Stripe's currency, country, locale).
    if (/^currency$/i.test(name)) return { value: "usd", source: "name" };
    if (/^country$/i.test(name)) return { value: "US", source: "name" };
    if (/^locale$/i.test(name)) return { value: "en-US", source: "name" };
    if (/^(name|display_name|title|description|label)$/i.test(name)) {
      return { value: "zond-probe", source: "name" };
    }
    // Generic fallback — confidence drops to medium.
    return { value: `zond-probe-${name}`.slice(0, 64), source: "fallback" };
  }
  if (type === "integer" || type === "number") {
    if (/amount|price|quantity|count|size|fee/i.test(name)) {
      return { value: 1000, source: "name" };
    }
    return { value: 100, source: "type" };
  }
  if (type === "boolean") return { value: false, source: "type" };
  if (type === "array") return { value: [], source: "type" };
  // object / null / unknown → can't safely fabricate.
  return undefined;
}

function pickEnvVar(name: string, env: Record<string, string>): string | undefined {
  if (isUsableEnvValue(env[name])) return name;
  const withId = `${name}_id`;
  if (isUsableEnvValue(env[withId])) return withId;
  const stripped = name.replace(FK_SUFFIX_RE, "");
  if (stripped !== name && isUsableEnvValue(env[stripped])) return stripped;
  return undefined;
}

function isUsableEnvValue(v: string | undefined): boolean {
  if (typeof v !== "string" || v.length === 0) return false;
  const t = v.trim().toLowerCase();
  if (t === "" || t === "string" || t === "example") return false;
  if (t.startsWith("todo") || t.startsWith("<")) return false;
  return true;
}

// ─── Orchestration ───────────────────────────────────────────────────

export function inferForAspect(
  aspect: Aspect,
  slice: ResourceSlice,
  env: Record<string, string> = {},
): AutoInference | null {
  switch (aspect) {
    case "pagination": return inferPagination(slice);
    case "lifecycle":  return inferLifecycle(slice);
    case "idempotency": return inferIdempotency(slice);
    case "seed-bodies": return inferSeedBody(slice, env);
  }
}

export function inferAll(
  slices: ResourceSlice[],
  aspects: Aspect[],
  env: Record<string, string> = {},
): AutoInference[] {
  const out: AutoInference[] = [];
  for (const slice of slices) {
    for (const aspect of aspects) {
      const inf = inferForAspect(aspect, slice, env);
      if (inf) out.push(inf);
    }
  }
  return out;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function meetsConfidence(have: Confidence, want: Confidence): boolean {
  return CONFIDENCE_RANK[have] >= CONFIDENCE_RANK[want];
}
