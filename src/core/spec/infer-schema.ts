/**
 * ARV-175: infer a JSON Schema (draft-07 subset) from a set of sample
 * response bodies. Built-in, zero-dependency — quicktype/genson would each
 * drag in a large dependency tree, which contradicts zond's dumb-tool /
 * minimal-deps charter (see src/CLAUDE.md). The `--engine` flag keeps the
 * seam open if a heavier engine is ever wanted, but `builtin` is the default
 * and the only one wired.
 *
 * Strategy — structural union over the samples:
 *   - primitives → { type }
 *   - arrays     → { type: "array", items: <merge of every element> }
 *   - objects    → { type: "object", properties, required }
 *                  `required` = keys present in EVERY object sample (an
 *                  intersection — a field missing from one sample is optional).
 *   - mixed types across samples → { type: [sorted, unique] } (or a bare
 *     type when they all agree). null folds into the type list so a
 *     sometimes-null field reads as `["null","string"]`.
 *
 * Not a full inference engine: no format detection, no enum mining, no
 * anyOf for heterogeneous array items beyond a type union. Good enough to
 * seed `response_schema_conformance` on specs that declare no response
 * schema, which is the whole point (ARV-175 goal).
 */

export type JsonSchema = Record<string, unknown>;

type JsonType = "null" | "boolean" | "integer" | "number" | "string" | "array" | "object";

function typeOf(v: unknown): JsonType {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "boolean") return "boolean";
  if (t === "number") return Number.isInteger(v) ? "integer" : "number";
  if (t === "string") return "string";
  return "object";
}

/** Infer a schema from one or more samples of the same logical value. */
export function inferSchema(samples: unknown[]): JsonSchema {
  const nonEmpty = samples.filter((s) => s !== undefined);
  if (nonEmpty.length === 0) return {};

  const types = new Set<JsonType>();
  for (const s of nonEmpty) types.add(typeOf(s));

  // Object: merge properties across every object sample.
  if (types.has("object")) {
    const objSamples = nonEmpty.filter((s) => typeOf(s) === "object") as Array<Record<string, unknown>>;
    const propSamples = new Map<string, unknown[]>();
    for (const obj of objSamples) {
      for (const [k, v] of Object.entries(obj)) {
        if (!propSamples.has(k)) propSamples.set(k, []);
        propSamples.get(k)!.push(v);
      }
    }
    // required = keys present in ALL object samples (intersection).
    const required = [...propSamples.keys()].filter(
      (k) => objSamples.every((obj) => Object.prototype.hasOwnProperty.call(obj, k)),
    );
    const properties: JsonSchema = {};
    for (const [k, vs] of propSamples) properties[k] = inferSchema(vs);

    const schema: JsonSchema = { type: mergeType(types, "object") };
    if (Object.keys(properties).length > 0) schema.properties = sortKeys(properties);
    if (required.length > 0) schema.required = required.sort();
    return schema;
  }

  // Array: items schema is the union of every element across every sample.
  if (types.has("array")) {
    const elements: unknown[] = [];
    for (const s of nonEmpty) if (Array.isArray(s)) elements.push(...s);
    const schema: JsonSchema = { type: mergeType(types, "array") };
    if (elements.length > 0) schema.items = inferSchema(elements);
    return schema;
  }

  // Primitives only.
  return { type: mergeType(types) };
}

/** Collapse the observed type set into a single `type` value: a string when
 *  they agree (preferring `primary` if given, e.g. object/array), otherwise a
 *  sorted unique list. `integer`+`number` collapses to `number`. */
function mergeType(types: Set<JsonType>, primary?: JsonType): string | string[] {
  const t = new Set(types);
  if (t.has("number") && t.has("integer")) t.delete("integer");
  if (primary && t.size > 1) {
    // Object/array with a stray null etc. — keep the structural type plus null.
    const rest = [...t].filter((x) => x !== primary);
    if (rest.length === 1 && rest[0] === "null") return [primary, "null"].sort();
  }
  const arr = [...t].sort();
  return arr.length === 1 ? arr[0]! : arr;
}

function sortKeys(obj: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}
