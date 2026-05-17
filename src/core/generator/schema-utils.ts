import type { OpenAPIV3 } from "openapi-types";

/**
 * Deep-clone an object, replacing circular references with the vendor-extension
 * sentinel `{ "x-circular": true }`. Uses WeakSet to track visited objects.
 *
 * Trade-off (intentional): we mark the SECOND visit of any shared object
 * (post-`dereference()` $ref-target reused under multiple parents) as
 * circular, not just true cycles. The alternative — a DFS path stack —
 * preserves every duplicate fresh, but blows the GitHub spec from 14 MB
 * to 106 MB on disk because shared `per_page`/`page`/`owner` params and
 * response schemas are re-cloned for every endpoint that references them.
 * Downstream tools that need param/schema visibility on every endpoint
 * (e.g. `zond api annotate auto`, ARV-262) handle this by re-reading the
 * source spec themselves rather than relying on `apis/<name>/spec.json`.
 *
 * Why a vendor extension and not `$ref`: the decycled doc is now written to
 * disk (apis/<name>/spec.json) and re-read by `@readme/openapi-parser` in
 * downstream commands (check spec, describe, generate). If the sentinel
 * carried a `$ref` field, the parser would try to resolve its value as a
 * JSON pointer / file path — e.g. `apis/stripe/[Circular]` — and fail
 * (ARV-146). `x-*` keys are explicitly reserved for vendor extensions in
 * OpenAPI 3.x and pass through every parser untouched.
 */
export function decycleSchema(obj: unknown): unknown {
  const seen = new WeakSet<object>();

  function walk(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;

    if (Array.isArray(value)) {
      return value.map(item => walk(item));
    }

    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) {
      // ARV-262: parameter-shaped objects (have both `name` and `in`)
      // appear post-`dereference()` as shared identities across every
      // endpoint that $ref'd them — `per_page`, `page`, `owner`, etc.
      // Past the first visit, the full `{"x-circular": true}` stub
      // erases name+in and downstream tools (annotate auto, generator)
      // can no longer tell what query/header that slot represented.
      // Preserve name+in on revisit; schema/required/description still
      // collapse so the bulk-size trade-off is unchanged (revisits
      // grow by ~30 B each, vs. ~7×-blowup if we cloned everything).
      if (typeof obj.name === "string" && typeof obj.in === "string") {
        return { name: obj.name, in: obj.in };
      }
      return { "x-circular": true };
    }
    seen.add(obj);

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = walk(obj[key]);
    }
    return result;
  }

  return walk(obj);
}

/**
 * Returns true if the schema is effectively `any` — no type, no properties, no constraints.
 */
export function isAnySchema(schema: OpenAPIV3.SchemaObject | undefined): boolean {
  if (!schema) return false;
  return Object.keys(schema).length === 0 ||
    (!schema.type && !schema.properties && !schema.enum && !schema.oneOf && !schema.allOf && !schema.anyOf);
}

/**
 * Compress an OpenAPI schema into a concise human-readable string.
 * E.g. { name: string (req), age: integer, tags: [string] }
 */
export function compressSchema(schema: OpenAPIV3.SchemaObject, depth = 0): string {
  if (depth > 2) return "{...}";

  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties).map(([key, propObj]) => {
      const prop = propObj as OpenAPIV3.SchemaObject;
      const type = prop.type ?? "any";
      const flags: string[] = [];
      if (required.has(key)) flags.push("req");
      if (prop.format) flags.push(prop.format);
      if (prop.enum) flags.push(`enum: ${prop.enum.join("|")}`);
      const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
      return `${key}: ${type}${flagStr}`;
    });
    return `{ ${fields.join(", ")} }`;
  }

  if (schema.type === "array") {
    const items = schema.items as OpenAPIV3.SchemaObject | undefined;
    if (items) return `[${compressSchema(items, depth + 1)}]`;
    return "[]";
  }

  return schema.type ?? "any";
}

/**
 * Format an OpenAPI parameter into a concise string.
 * E.g. "limit: integer" or "id: string (req)"
 */
export function formatParam(p: OpenAPIV3.ParameterObject): string {
  const schema = p.schema as OpenAPIV3.SchemaObject | undefined;
  const type = schema?.type ?? "string";
  const req = p.required ? " (req)" : "";
  return `${p.name}: ${type}${req}`;
}
