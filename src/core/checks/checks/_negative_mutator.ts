/**
 * Single-site negative-body mutator (m-15 ARV-4). Applies exactly one
 * mutation to a valid body so the data-rejection check can attribute
 * accept/reject decisions to a known cause. Three strategies, picked
 * in priority order:
 *
 *   1. drop_required        — remove the first required field.
 *   2. type_mutation        — flip the first scalar field's type.
 *   3. constraint_violation — violate the first declared constraint
 *                              (minLength/maximum/pattern/enum).
 *
 * The first applicable strategy wins — keeps mutations deterministic
 * across runs (matches schemathesis' "isolate the failure site" goal).
 * `meta` carries the strategy + field path so anti-FP guards and
 * findings can describe what was changed without reparsing the body.
 */
import type { OpenAPIV3 } from "openapi-types";
import { generateFromSchema } from "../../generator/data-factory.ts";

export interface MutationMeta {
  mutation: "drop_required" | "type_mutation" | "constraint_violation";
  field_path: string;
  /** For type_mutation. */
  from_type?: string;
  to_type?: string;
  to_value?: unknown;
  /** For constraint_violation. */
  constraint?: string;
}

export interface MutationResult {
  body: unknown;
  meta: MutationMeta;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickWrongValue(t: string): { type: string; value: unknown } {
  // Pick a value that is *clearly* the wrong type — and not a string
  // that the server might coerce. Anti-FP guard #2 takes care of the
  // "stringified primitive" case separately, but we avoid emitting it
  // in the first place where we can.
  switch (t) {
    case "integer":
    case "number":
      return { type: "boolean", value: true };
    case "boolean":
      return { type: "integer", value: 7 };
    case "string":
      return { type: "object", value: { unexpected: "shape" } };
    case "array":
      return { type: "object", value: {} };
    case "object":
      return { type: "array", value: [] };
    default:
      return { type: "boolean", value: true };
  }
}

function tryDropRequired(schema: OpenAPIV3.SchemaObject, body: unknown): MutationResult | null {
  if (!isObject(body)) return null;
  const required = schema.required ?? [];
  for (const f of required) {
    if (f in body) {
      const next = { ...body };
      delete next[f];
      return { body: next, meta: { mutation: "drop_required", field_path: f, dropped_field: f } as MutationMeta };
    }
  }
  return null;
}

function tryTypeMutation(schema: OpenAPIV3.SchemaObject, body: unknown): MutationResult | null {
  if (!isObject(body)) return null;
  const props = (schema.properties ?? {}) as Record<string, OpenAPIV3.SchemaObject>;
  for (const [name, propSchema] of Object.entries(props)) {
    const t = propSchema.type;
    if (typeof t !== "string") continue;
    if (!(name in body)) continue;
    const wrong = pickWrongValue(t);
    return {
      body: { ...body, [name]: wrong.value },
      meta: {
        mutation: "type_mutation",
        field_path: name,
        from_type: t,
        to_type: wrong.type,
        to_value: wrong.value,
      },
    };
  }
  return null;
}

function tryConstraintViolation(schema: OpenAPIV3.SchemaObject, body: unknown): MutationResult | null {
  if (!isObject(body)) return null;
  const props = (schema.properties ?? {}) as Record<string, OpenAPIV3.SchemaObject>;
  for (const [name, propSchema] of Object.entries(props)) {
    if (!(name in body)) continue;
    if (propSchema.enum && propSchema.enum.length > 0) {
      return { body: { ...body, [name]: "__not_in_enum__" }, meta: { mutation: "constraint_violation", field_path: name, constraint: "enum" } };
    }
    if (typeof propSchema.minLength === "number" && propSchema.minLength > 0) {
      return { body: { ...body, [name]: "" }, meta: { mutation: "constraint_violation", field_path: name, constraint: "minLength" } };
    }
    if (typeof propSchema.maxLength === "number") {
      return {
        body: { ...body, [name]: "x".repeat(propSchema.maxLength + 1) },
        meta: { mutation: "constraint_violation", field_path: name, constraint: "maxLength" },
      };
    }
    if (typeof propSchema.minimum === "number") {
      return { body: { ...body, [name]: propSchema.minimum - 1 }, meta: { mutation: "constraint_violation", field_path: name, constraint: "minimum" } };
    }
    if (typeof propSchema.maximum === "number") {
      return { body: { ...body, [name]: propSchema.maximum + 1 }, meta: { mutation: "constraint_violation", field_path: name, constraint: "maximum" } };
    }
  }
  return null;
}

/**
 * Build a single-site negative case from a request-body schema.
 * Returns `null` when the schema offers no exploit surface (no
 * required fields, no typed properties, no constraints) — the caller
 * should skip emitting a probe rather than send a meaningless one.
 */
export function buildNegativeBody(schema: OpenAPIV3.SchemaObject): MutationResult | null {
  const valid = generateFromSchema(schema);
  return tryDropRequired(schema, valid) ?? tryTypeMutation(schema, valid) ?? tryConstraintViolation(schema, valid);
}
