/**
 * Fuzz phase (m-28 ARV-436) — property-based random enumeration for a
 * request-body schema, on top of fast-check. Where `coverage-phase`
 * walks *declared boundaries* deterministically, this phase draws
 * *random* bodies from the schema so any 5xx / schema-violation the
 * boundary walker never happened to hit falls out as evidence.
 *
 * Two invariants that keep it a zond-shaped dumb-tool (see src/CLAUDE.md):
 *
 *   - **Seeded determinism** — `enumerateFuzzCases(schema, {seed})`
 *     returns the same bodies in the same order for the same seed.
 *     fast-check's PRNG is seeded, so a run is reproducible; the agent
 *     re-runs with the same `--seed` and gets byte-identical cases.
 *   - **No judgement** — this file only *generates* input. Whether a
 *     resulting response is a bug / FP / which severity is the agent's
 *     call in triage. zond emits the raw input + (on failure) a minimal
 *     shrunk counterexample.
 *
 * The bridge `schemaToArbitrary` reuses the closed-vocab hints already
 * living in `data-factory` (enum, format, currency/country/mcc/email
 * field-names) so most fuzz bodies clear the API's first validation
 * layer instead of being 100% garbage → 400.
 */
import fc from "fast-check";
import type { OpenAPIV3 } from "openapi-types";

import { canonicalVarName, isCurrencyFieldName } from "./data-factory.ts";

// Real-value vocab pools for closed-vocab field names — fast-check emits
// one of these, so the field passes format/enum validation but still
// varies run-to-run. Small on purpose: the long tail of field-name
// heuristics lives in data-factory; we only reuse the highest-frequency
// gates that otherwise 400 the whole body.
const CURRENCY_POOL = ["usd", "eur", "gbp", "jpy", "cad", "aud"];
const COUNTRY_POOL = ["US", "GB", "DE", "FR", "JP", "CA"];
const MCC_POOL = ["5734", "5045", "5651", "7372", "5812"];

function isCountryFieldName(lower: string): boolean {
  return lower === "country" || lower === "country_code"
    || lower.endsWith("_country") || lower.endsWith("_country_code");
}

function isMccFieldName(lower: string): boolean {
  return lower === "mcc" || lower.endsWith("_mcc") || lower === "merchant_category_code";
}

function isEmailFieldName(lower: string): boolean {
  return lower === "email" || lower === "from" || lower === "to" || lower === "cc"
    || lower === "bcc" || lower === "sender" || lower === "recipient" || lower === "reply_to"
    || lower.endsWith("_email") || lower.endsWith("_reply_to")
    || lower.endsWith("_from") || lower.endsWith("_to") || lower.endsWith("_cc") || lower.endsWith("_bcc");
}

/** A string arbitrary picked from a field's name when the schema itself
 *  gives no format/enum. Mirrors `guessStringPlaceholder` in data-factory
 *  but emits *real* values (not `{{template}}`) since fuzz bodies are sent
 *  directly, not interpolated by the runner. */
function nameVocabArbitrary(name: string | undefined): fc.Arbitrary<string> | undefined {
  if (!name) return undefined;
  const lower = canonicalVarName(name);
  if (isCurrencyFieldName(lower)) return fc.constantFrom(...CURRENCY_POOL);
  if (isCountryFieldName(lower)) return fc.constantFrom(...COUNTRY_POOL);
  if (isMccFieldName(lower)) return fc.constantFrom(...MCC_POOL);
  if (isEmailFieldName(lower)) return fc.emailAddress();
  return undefined;
}

function formatArbitrary(format: string | undefined): fc.Arbitrary<string> | undefined {
  switch (format) {
    case "uuid": return fc.uuid();
    case "email": return fc.emailAddress();
    case "uri":
    case "url": return fc.webUrl();
    case "date-time": return fc.date({ noInvalidDate: true }).map((d) => d.toISOString());
    case "date": return fc.date({ noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
    case "iso-country-code":
    case "country-code":
    case "country": return fc.constantFrom(...COUNTRY_POOL);
    case "iso-currency-code":
    case "currency-code":
    case "currency": return fc.constantFrom(...CURRENCY_POOL);
    case "mcc": return fc.constantFrom(...MCC_POOL);
    default: return undefined;
  }
}

function stringArbitrary(schema: OpenAPIV3.SchemaObject, name?: string): fc.Arbitrary<string> {
  const byFormat = formatArbitrary(schema.format);
  if (byFormat) return byFormat;
  const byName = nameVocabArbitrary(name);
  if (byName) return byName;
  const minLength = typeof schema.minLength === "number" ? schema.minLength : 0;
  const maxLength = typeof schema.maxLength === "number" ? schema.maxLength : minLength + 16;
  return fc.string({ minLength, maxLength: Math.max(minLength, maxLength) });
}

function numberArbitrary(schema: OpenAPIV3.SchemaObject): fc.Arbitrary<number> {
  const isInt = schema.type === "integer";
  let min = typeof schema.minimum === "number" ? schema.minimum : undefined;
  let max = typeof schema.maximum === "number" ? schema.maximum : undefined;
  // OpenAPI 3.0 boolean exclusive* nudges the inclusive bound one step in.
  if (schema.exclusiveMinimum === true && min !== undefined) min += isInt ? 1 : Number.EPSILON;
  if (schema.exclusiveMaximum === true && max !== undefined) max -= isInt ? 1 : Number.EPSILON;
  if (isInt) {
    return fc.integer({
      min: min !== undefined ? Math.ceil(min) : undefined,
      max: max !== undefined ? Math.floor(max) : undefined,
    });
  }
  return fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
}

const MAX_DEPTH = 5;

/**
 * Map a (dereferenced) OpenAPI schema to a fast-check arbitrary. Covers
 * the common OpenAPI subset — type/format/enum/min/max/items/properties/
 * required — and falls back to a string arbitrary for anything unknown so
 * the generator never throws on an exotic schema. `name` carries the
 * property name so closed-vocab field-name hints can fire.
 *
 * ponytail: nullable/allOf-merge/pattern-satisfying strings are out of
 * scope for phase 1 — add them when a real spec needs the extra pass-rate.
 */
export function schemaToArbitrary(
  schema: OpenAPIV3.SchemaObject,
  name?: string,
  depth = 0,
): fc.Arbitrary<unknown> {
  if (depth > MAX_DEPTH) return fc.string();

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return fc.constantFrom(...schema.enum);
  }

  // oneOf / anyOf — draw from any declared variant.
  const union = schema.oneOf ?? schema.anyOf;
  if (union && union.length > 0) {
    return fc.oneof(...union.map((v) => schemaToArbitrary(v as OpenAPIV3.SchemaObject, name, depth + 1)));
  }
  // allOf — shallow-merge object members (lazy: properties/required only).
  if (schema.allOf && schema.allOf.length > 0) {
    const merged: OpenAPIV3.SchemaObject = { type: "object", properties: {}, required: [] };
    for (const part of schema.allOf as OpenAPIV3.SchemaObject[]) {
      Object.assign(merged.properties!, part.properties ?? {});
      (merged.required as string[]).push(...(part.required ?? []));
    }
    return schemaToArbitrary(merged, name, depth + 1);
  }

  const type = Array.isArray(schema.type)
    ? (schema.type as string[]).find((t) => t !== "null")
    : schema.type;

  switch (type) {
    case "string":
      return stringArbitrary(schema, name);
    case "integer":
    case "number":
      return numberArbitrary(schema);
    case "boolean":
      return fc.boolean();
    case "array": {
      const items = (schema as OpenAPIV3.ArraySchemaObject).items as OpenAPIV3.SchemaObject | undefined;
      const itemArb = items ? schemaToArbitrary(items, undefined, depth + 1) : fc.string();
      const minLength = typeof schema.minItems === "number" ? schema.minItems : 0;
      const maxLength = typeof schema.maxItems === "number" ? schema.maxItems : minLength + 3;
      return fc.array(itemArb, { minLength, maxLength: Math.max(minLength, maxLength) });
    }
    case "object": {
      const props = (schema.properties ?? {}) as Record<string, OpenAPIV3.SchemaObject>;
      const required = new Set((schema.required ?? []) as string[]);
      const model: Record<string, fc.Arbitrary<unknown>> = {};
      // readOnly / server-assigned `id` must not be sent — same rule as
      // data-factory's request-body generator.
      for (const [key, propSchema] of Object.entries(props)) {
        if (propSchema.readOnly === true || key === "id") continue;
        model[key] = schemaToArbitrary(propSchema, key, depth + 1);
      }
      const requiredKeys = [...required].filter((k) => k in model);
      return fc.record(model, { requiredKeys });
    }
    default:
      // Unknown / untyped → a string, per the task's fallback rule.
      return fc.string();
  }
}

export interface FuzzCase {
  /** The randomly-drawn request body. */
  body: unknown;
}

export interface FuzzOptions {
  /** PRNG seed — same seed ⇒ same cases. Default 0 for reproducible runs. */
  seed?: number;
  /** How many random bodies to draw per operation. */
  numRuns?: number;
}

/**
 * Draw `numRuns` random bodies from a request-body schema. Deterministic
 * for a fixed seed. The runner wraps each into a `BuiltCase` and dispatches
 * it through the normal worker/rate-limit path.
 */
export function enumerateFuzzCases(
  schema: OpenAPIV3.SchemaObject,
  opts: FuzzOptions = {},
): FuzzCase[] {
  const arb = schemaToArbitrary(schema);
  const bodies = fc.sample(arb, { numRuns: opts.numRuns ?? 20, seed: opts.seed ?? 0 });
  return bodies.map((body) => ({ body }));
}

export interface ShrinkResult<R> {
  /** Minimal body that still makes the check fail. */
  body: unknown;
  /** Response observed for that minimal body. */
  response: R;
}

/**
 * Shrink a failing fuzz body to a minimal counterexample. fast-check
 * generates + shrinks; `send` performs the HTTP call and `stillFails`
 * re-applies the same check verdict to the response. The property "holds"
 * (returns true) when the check PASSES, so fast-check drives toward the
 * smallest body that keeps it failing.
 *
 * Returns null if nothing failed within the budget (e.g. the original
 * failure was non-deterministic / already cleaned up).
 */
export async function shrinkFuzzFailure<R>(params: {
  schema: OpenAPIV3.SchemaObject;
  seed?: number;
  numRuns?: number;
  send: (body: unknown) => Promise<R>;
  stillFails: (response: R) => boolean;
}): Promise<ShrinkResult<R> | null> {
  const arb = schemaToArbitrary(params.schema);
  // NB: no `endOnFailure` — that flag *disables* shrinking (stops at the
  // first raw counterexample). We want fast-check to shrink toward the
  // minimal failing body, so we let it run the full shrink walk.
  const result = await fc.check(
    fc.asyncProperty(arb, async (body) => {
      let response: R;
      try {
        response = await params.send(body);
      } catch {
        // A transient network flake on ONE shrink sample must not abort the
        // whole shrink walk (real rate-limited APIs drop the odd request
        // during rapid re-sends). Treat it as "not a counterexample" so
        // fast-check keeps exploring toward the minimal reproducible body.
        return true;
      }
      return !params.stillFails(response); // property holds when the check passes
    }),
    { seed: params.seed ?? 0, numRuns: params.numRuns ?? 30 },
  );
  if (!result.failed || result.counterexample === null) return null;
  const minimalBody = result.counterexample[0];
  // Re-send the shrunk body once so the evidence carries its real response.
  const response = await params.send(minimalBody);
  return { body: minimalBody, response };
}
