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
// List-filter literals that appear in `?status=` query enums but are not
// actual resource states (Stripe: `all`; some APIs: `any`, `none`).
const LIST_FILTER_LITERALS = new Set(["all", "any", "none"]);

export function inferLifecycle(slice: ResourceSlice): AutoInference | null {
  const ep = slice.endpoints.read ?? slice.endpoints.list ?? slice.endpoints.create;
  if (!ep) return null;
  const schema = ok200Schema(ep);
  const props = schema
    ? (schema as { properties?: Record<string, unknown> }).properties
    : undefined;

  if (props) {
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
  }

  // Fallback: when the response schema is x-circular / missing properties
  // (decycleSchema collapses second-visit refs on dense graphs like Stripe),
  // look at the list endpoint's `?status=`/`?state=` query enum. Stripe
  // declares the full state enum on these list-filters, so this fallback
  // lifts ~8 classic state machines (subscriptions/invoices/payouts/etc)
  // on Stripe that would otherwise be 0.
  const list = slice.endpoints.list;
  if (list && list.parameters) {
    for (const candidate of STATE_FIELD_NAMES) {
      const param = list.parameters.find(
        (p) => p.in === "query" && p.name.toLowerCase() === candidate,
      );
      if (!param) continue;
      const paramSchema = param.schema as { type?: string; enum?: unknown[] } | undefined;
      if (!paramSchema || !Array.isArray(paramSchema.enum)) continue;
      const raw = paramSchema.enum.filter((s): s is string => typeof s === "string");
      const states = raw.filter((s) => !LIST_FILTER_LITERALS.has(s.toLowerCase()));
      if (states.length < 2) continue;
      return {
        resource: slice.resource,
        aspect: "lifecycle",
        confidence: "medium",
        rationale: `list endpoint query param ${param.name} enum has ${states.length} states (response schema unavailable — fallback)`,
        patch: {
          resource: slice.resource,
          lifecycle: {
            field: param.name,
            states,
            transitions: [],
            actions: {},
          },
        },
      };
    }
  }

  // ARV-272: final fallback — mine description text + cluster response
  // examples for state values. Stripe (and similar) declare the status
  // field without an `enum`, listing the allowed values in prose
  // ("Possible values: active, canceled, ...") and via response
  // examples. Source A is text-mining-brittle (low), Source B is real
  // data (medium); both agreeing → high.
  if (props) {
    for (const candidate of STATE_FIELD_NAMES) {
      const found = findCaseInsensitive(props, candidate);
      if (!found) continue;
      const fieldSchema = found.value as { description?: string } | undefined;
      const descStates = extractEnumFromDescription(fieldSchema?.description);
      const exampleStates = collectStatusExamples(slice, found.name);

      let states: string[] = [];
      let confidence: AutoInference["confidence"] | null = null;
      let rationale = "";
      const exampleSet = new Set(exampleStates);
      const overlap = descStates.filter((s) => exampleSet.has(s));

      if (descStates.length >= 3 && overlap.length >= 1) {
        states = Array.from(new Set([...descStates, ...exampleStates]));
        confidence = "high";
        rationale = `${found.name}: ${descStates.length} values from description, ${exampleStates.length} from examples (${overlap.length} overlap)`;
      } else if (exampleStates.length >= 3) {
        states = exampleStates;
        confidence = "medium";
        rationale = `${found.name}: ${exampleStates.length} distinct values clustered from spec examples`;
      } else if (descStates.length >= 3) {
        states = descStates;
        confidence = "low";
        rationale = `${found.name}: ${descStates.length} values mined from description text`;
      } else {
        continue;
      }

      return {
        resource: slice.resource,
        aspect: "lifecycle",
        confidence,
        rationale,
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
  }

  return null;
}

const POSSIBLE_VALUES_RE = /(?:possible|allowed|valid|accepted|supported)\s+values?\s*[:\-—]?\s*([^.\n]+)/i;

/**
 * Mine an enum-like list of values from a free-text description that
 * follows the "Possible values: a, b, c" / "Allowed values - a | b | c"
 * convention (Stripe, Twilio, GitHub partial). Returns deduped, in-
 * order tokens after stripping wrapping quotes/backticks/punctuation.
 */
export function extractEnumFromDescription(desc: string | undefined): string[] {
  if (!desc) return [];
  const m = desc.match(POSSIBLE_VALUES_RE);
  if (!m) return [];
  const tail = m[1]!;
  const tokens = tail
    .split(/\s*(?:,|\sor\s|\|)\s*/i)
    .map((t) => t.replace(/^["'`]+|["'`,.;:]+$/g, "").trim())
    .filter((t) => t.length > 0 && t.length < 60 && /^[a-z0-9_\-]+$/i.test(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Cluster distinct values of `fieldName` across all endpoints' response
 * schema examples and request-body examples in the slice. Honors both
 * shapes: a per-property `example` on the field schema, and a
 * whole-object `example` on the requestBody.
 */
export function collectStatusExamples(slice: ResourceSlice, fieldName: string): string[] {
  const seen = new Set<string>();
  const lower = fieldName.toLowerCase();
  const collectFromObject = (obj: unknown): void => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k.toLowerCase() === lower && typeof v === "string") seen.add(v);
    }
  };
  for (const ep of Object.values(slice.endpoints)) {
    if (!ep) continue;
    collectFromObject(ep.requestBody?.example);
    for (const resp of Object.values(ep.responses ?? {})) {
      const sch = resp?.schema as
        | { properties?: Record<string, unknown>; example?: unknown }
        | undefined;
      if (!sch) continue;
      collectFromObject(sch.example);
      const props = sch.properties;
      if (!props) continue;
      const found = findCaseInsensitive(props, fieldName);
      if (!found) continue;
      const v = found.value as { example?: unknown; enum?: unknown[] } | undefined;
      if (typeof v?.example === "string") seen.add(v.example);
    }
  }
  return Array.from(seen);
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
 * Recurses into nested objects and required-items arrays so that
 * APIs declaring proper nested `required` arrays (Linear, GitHub
 * Issues, Notion, GraphQL-style REST gateways) get full coverage.
 * Stripe's form-urlencoded wire format is handled by `encodeFormBody`
 * downstream — the inferred body stays as a nested JS object and the
 * encoder flattens to `parent[child]=value` bracket notation.
 *
 * Still returns null when the schema is too ambiguous for safe
 * heuristic — `oneOf`/`anyOf` discriminator XORs and required fields
 * whose type we can't fabricate (binary, free-form objects). Those
 * cases stay for the agent-loop (ARV-187 dump+apply). The inference
 * surfaces remaining gaps through the `rationale` field so the calling
 * agent knows what it still has to fill in.
 */
export function inferSeedBody(
  slice: ResourceSlice,
  env: Record<string, string> = {},
): AutoInference | null {
  const create = slice.endpoints.create;
  if (!create) return null;
  const rb = create.requestBody;
  if (!rb || !rb.schema || typeof rb.schema !== "object") return null;
  const root = mergeAllOf(rb.schema as Record<string, unknown>);
  // simplifySchema collapses oneOf/anyOf to *_first siblings; top-level
  // unions can't be disambiguated without the LLM.
  if (root.oneOf_first || root.anyOf_first) return null;
  const required = collectRequired(root);
  if (required.length === 0) return null;
  const props = (root.properties as Record<string, Record<string, unknown>> | undefined);
  if (!props) return null;

  const stats: BuildStats = { envHits: 0, fallbacks: 0, gaps: [] };
  const body: Record<string, unknown> = {};
  for (const field of required) {
    const fieldSchema = props[field];
    if (!fieldSchema) {
      stats.gaps.push(`${field}: required but no schema in properties`);
      continue;
    }
    const picked = pickSeedValue(field, fieldSchema, env, stats, 0);
    if (picked === undefined) {
      // Recursion failed for this field (e.g. nested oneOf union, binary
      // upload, unfabricatable type). Record the gap so the agent that
      // post-processes the overlay can fill it in via ARV-187 dump+apply.
      stats.gaps.push(`${field}: ${describeGap(fieldSchema)}`);
      continue;
    }
    body[field] = picked.value;
    if (picked.source === "env") stats.envHits++;
    if (picked.source === "fallback") stats.fallbacks++;
  }

  // Nothing landed — the create endpoint is entirely gap. Don't pollute
  // the overlay with an empty seed_body; let the agent author it from
  // dump output.
  if (Object.keys(body).length === 0) return null;

  // Confidence ranking (calibrated post-Stripe ARV-270 dogfooding):
  //   - any generic-fallback string (`zond-probe-<name>`) → low. These
  //     are placeholders, not inferences — strict validators (Stripe,
  //     Twilio) reject them, and including them at `medium` lulled
  //     agents into trusting partial heuristic output as if it was a
  //     working seed body. Marked `low` so default `--confidence high`
  //     filters them, but `--confidence low` still surfaces the partial
  //     skeleton for the agent-loop to top up.
  //   - any unfilled gap (oneOf union, binary upload, free-form object)
  //     → medium. The filled portion is real, just incomplete.
  //   - otherwise → high.
  const confidence: Confidence = stats.fallbacks > 0
    ? "low"
    : stats.gaps.length > 0
      ? "medium"
      : "high";

  const gapNote = stats.gaps.length > 0 ? `; ${stats.gaps.length} gap(s): ${stats.gaps.slice(0, 3).join("; ")}${stats.gaps.length > 3 ? "; …" : ""}` : "";
  const fillCount = Object.keys(body).length;
  return {
    resource: slice.resource,
    aspect: "seed-bodies",
    confidence,
    rationale: `${fillCount}/${required.length} required field(s) filled heuristically${stats.envHits > 0 ? ` (${stats.envHits} FK from env)` : ""}${stats.fallbacks > 0 ? "; some via generic fallback" : ""}${gapNote}`,
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
  source: "enum" | "format" | "name" | "env" | "type" | "fallback" | "object" | "array";
}

interface BuildStats {
  envHits: number;
  fallbacks: number;
  /** Per-field reasons the heuristic skipped a required entry, in the
   *  form `<path>: <why>`. Surfaced via `rationale` so the calling
   *  agent (or human reading the overlay) sees what's missing. */
  gaps: string[];
}

/**
 * Max recursion depth when building a nested seed body. Cap exists so
 * pathological self-referential schemas (e.g. comment.replies.replies…)
 * can't stack-overflow the heuristic. Three is enough for the typical
 * `resource → nested-config → list-of-filters` Stripe pattern; deeper
 * is agent territory.
 */
const MAX_DEPTH = 3;

function pickSeedValue(
  name: string,
  schema: Record<string, unknown>,
  env: Record<string, string>,
  stats: BuildStats,
  depth: number,
): SeedValue | undefined {
  schema = mergeAllOf(schema);
  // Bail on discriminator XORs — first-variant guesses miss too often
  // to be safe at scale. Agent-loop knows how to pick.
  if (schema.oneOf_first || schema.anyOf_first) return undefined;

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

  const type = (schema.type as string | undefined) ?? inferTypeFromShape(schema);
  const format = schema.format as string | undefined;

  // 3. Object — recurse into required sub-fields.
  if (type === "object") {
    if (depth >= MAX_DEPTH) return undefined;
    const subProps = schema.properties as Record<string, Record<string, unknown>> | undefined;
    const subReq = collectRequired(schema);
    if (!subProps || subReq.length === 0) {
      // Object with no declared shape — caller has to free-form it via
      // agent. Note: empty object `{}` would be tempting but it
      // typically violates strict validators ("at least one of …").
      return undefined;
    }
    const nested: Record<string, unknown> = {};
    for (const sub of subReq) {
      const subSchema = subProps[sub];
      if (!subSchema) {
        stats.gaps.push(`${name}.${sub}: missing in properties`);
        continue;
      }
      const picked = pickSeedValue(sub, subSchema, env, stats, depth + 1);
      if (picked === undefined) {
        stats.gaps.push(`${name}.${sub}: ${describeGap(subSchema)}`);
        continue;
      }
      nested[sub] = picked.value;
      if (picked.source === "env") stats.envHits++;
      if (picked.source === "fallback") stats.fallbacks++;
    }
    if (Object.keys(nested).length === 0) return undefined;
    return { value: nested, source: "object" };
  }

  // 4. Array — emit one element if items are required-bearing objects;
  //    empty array otherwise (lets `[]` pass minItems=0 schemas).
  if (type === "array") {
    if (depth >= MAX_DEPTH) return { value: [], source: "type" };
    const items = schema.items as Record<string, unknown> | undefined;
    const minItems = typeof schema.minItems === "number" ? (schema.minItems as number) : 0;
    if (!items) return { value: [], source: "type" };
    const itemReq = collectRequired(items);
    if (minItems === 0 && itemReq.length === 0) return { value: [], source: "type" };
    // Build one representative item.
    const picked = pickSeedValue(`${name}[0]`, items, env, stats, depth + 1);
    if (picked === undefined) return { value: [], source: "type" };
    return { value: [picked.value], source: "array" };
  }

  // 5. Format-aware string defaults (AC #2).
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
    // Binary/file uploads can't be heuristically fabricated.
    if (format === "binary" || format === "byte") return undefined;
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
    // Unix-timestamp heuristic for fields named `*_at`, `*_time`,
    // `frozen_time`, `epoch`. Strict APIs (Stripe `test_clocks`,
    // GitHub workflow times) reject `100` for these and accept a
    // realistic past-epoch.
    if (/_(at|time|epoch)$|^(frozen_time|epoch|timestamp)$/i.test(name)) {
      return { value: 1735689600, source: "name" }; // 2025-01-01T00:00:00Z
    }
    if (/amount|price|quantity|count|size|fee/i.test(name)) {
      return { value: 1000, source: "name" };
    }
    return { value: 100, source: "type" };
  }
  if (type === "boolean") return { value: false, source: "type" };
  // null / unknown → can't safely fabricate.
  return undefined;
}

/**
 * One-line description of why a sub-schema can't be heuristically
 * filled. Surfaced in `rationale.gaps` so the agent that calls zond
 * sees actionable hints (e.g. `lines: array<oneOf>` → "needs agent to
 * pick a discriminator variant") without having to re-read the spec.
 */
function describeGap(schema: Record<string, unknown>): string {
  const s = mergeAllOf(schema);
  if (s.oneOf_first) return "oneOf union (needs agent to pick variant)";
  if (s.anyOf_first) return "anyOf union (needs agent to pick variant)";
  const type = (s.type as string | undefined) ?? inferTypeFromShape(s);
  if (type === "object") {
    if (!s.properties) return "free-form object (no declared shape)";
    const sub = collectRequired(s);
    return sub.length > 0
      ? `nested object with required [${sub.slice(0, 3).join(", ")}${sub.length > 3 ? ", …" : ""}]`
      : "nested object";
  }
  if (s.format === "binary" || s.format === "byte") return "binary/file upload";
  return `type=${type ?? "unknown"} not fabricatable`;
}

/** Infer `type` when the schema omits it but declares shape-signals. */
function inferTypeFromShape(schema: Record<string, unknown>): string | undefined {
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return undefined;
}

/**
 * `allOf` flattener: merge sibling schemas' `required` and `properties`.
 * Common in Stripe / GitHub specs where a base type is extended.
 * Conservative — drops nested allOf inside allOf branches; that's a
 * second-pass agent concern.
 */
function mergeAllOf(schema: Record<string, unknown>): Record<string, unknown> {
  const allOf = schema.allOf as Record<string, unknown>[] | undefined;
  if (!allOf || allOf.length === 0) return schema;
  const required = new Set<string>();
  const properties: Record<string, unknown> = {};
  // Seed with the parent's own fields so they aren't lost.
  if (Array.isArray(schema.required)) for (const r of schema.required) if (typeof r === "string") required.add(r);
  if (schema.properties && typeof schema.properties === "object") {
    Object.assign(properties, schema.properties as Record<string, unknown>);
  }
  for (const branch of allOf) {
    if (!branch || typeof branch !== "object") continue;
    if (Array.isArray(branch.required)) for (const r of branch.required) if (typeof r === "string") required.add(r);
    if (branch.properties && typeof branch.properties === "object") {
      Object.assign(properties, branch.properties);
    }
  }
  const out: Record<string, unknown> = { ...schema };
  delete out.allOf;
  out.required = Array.from(required);
  out.properties = properties;
  return out;
}

function collectRequired(schema: Record<string, unknown>): string[] {
  const merged = mergeAllOf(schema);
  const r = merged.required;
  return Array.isArray(r) ? (r as unknown[]).filter((x): x is string => typeof x === "string") : [];
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
