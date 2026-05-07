import type { OpenAPIV3 } from "openapi-types";

/**
 * Recursively generates test data from an OpenAPI schema.
 * Uses heuristic placeholders ({{$...}} generators) where possible.
 */
export function generateFromSchema(
  schema: OpenAPIV3.SchemaObject,
  propertyName?: string,
  _depth = 0,
): unknown {
  if (_depth > 5) return {};

  // Highest-priority signal: explicit example from spec.
  // Beats enum, format, heuristics — the spec author told us what to send.
  // Two exceptions:
  //   1. `null` examples are noise (often nullable: true with no real example) —
  //      skip so we fall through to type/format defaults instead of emitting null.
  //   2. UUID-shaped examples on FK-context fields (name ends with `_id` or
  //      schema.format === "uuid") are usually copy-pasted from another tenant's
  //      spec. Honoring them leaks foreign IDs and guarantees 422 on real APIs;
  //      `{{$uuid}}` is at least an honest test placeholder.
  if (schema.example !== undefined && schema.example !== null) {
    if (!isLikelyForeignFKExample(schema, propertyName)) {
      return schema.example;
    }
  }

  // allOf: merge all schemas
  if (schema.allOf) {
    const merged: OpenAPIV3.SchemaObject = { type: "object", properties: {} };
    for (const sub of schema.allOf) {
      const s = sub as OpenAPIV3.SchemaObject;
      if (s.properties) {
        merged.properties = { ...merged.properties, ...s.properties };
      }
    }
    return generateFromSchema(merged, propertyName, _depth + 1);
  }

  // oneOf / anyOf: pick the most informative variant. Prefer objects with
  // properties over loose primitives — APIs that accept `Array<{id}>|Array<string>`
  // need the object variant, not a string that 422s. Falls back to first
  // non-null entry.
  if (schema.oneOf) {
    return generateFromSchema(pickPreferredVariant(schema.oneOf as OpenAPIV3.SchemaObject[]), propertyName, _depth + 1);
  }
  if (schema.anyOf) {
    return generateFromSchema(pickPreferredVariant(schema.anyOf as OpenAPIV3.SchemaObject[]), propertyName, _depth + 1);
  }

  // enum: first value (always valid for the API contract)
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  // Format-based placeholders override type resolution. Schemas in the wild
  // commonly carry `format` without an explicit `type` (loosely-defined specs)
  // or with `type: ["string", "null"]` (OpenAPI 3.1 nullable). Falling through
  // to the type switch in those cases dropped us into the default branch and
  // produced `{{$randomString}}` for `format: email` — TASK-86 regression.
  const formatPlaceholder = formatToPlaceholder(schema.format);
  if (formatPlaceholder !== undefined) return formatPlaceholder;

  // OpenAPI 3.1: type can be `["string", "null"]`. Collapse to the first
  // non-null entry so the switch below routes correctly.
  const effectiveType = Array.isArray(schema.type)
    ? (schema.type as string[]).find(t => t !== "null") as OpenAPIV3.SchemaObject["type"] | undefined
    : schema.type;

  switch (effectiveType) {
    case "string":
      return guessStringPlaceholder(schema, propertyName);

    case "integer":
      return guessIntPlaceholder(propertyName, schema);

    case "number":
      return 29.99;

    case "boolean":
      return true;

    case "array": {
      const arr = schema as OpenAPIV3.ArraySchemaObject;
      if (arr.items) {
        const item = generateFromSchema(arr.items as OpenAPIV3.SchemaObject, undefined, _depth + 1);
        return [item];
      }
      return [];
    }

    case "object":
    default: {
      // Treat unknown type with properties as object
      if (schema.properties) {
        const obj: Record<string, unknown> = {};
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          obj[key] = generateFromSchema(propSchema as OpenAPIV3.SchemaObject, key, _depth + 1);
        }
        return obj;
      }
      // Record type: additionalProperties defines value schema
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        const valSchema = schema.additionalProperties as OpenAPIV3.SchemaObject;
        return { key1: generateFromSchema(valSchema, "key1", _depth + 1), key2: generateFromSchema(valSchema, "key2", _depth + 1) };
      }
      if (schema.additionalProperties === true) {
        return { key1: "value1", key2: "value2" };
      }
      // Bare object with no properties
      if (effectiveType === "object") {
        return {};
      }
      return "{{$randomString}}";
    }
  }
}

/** Prefer the most data-shape-informative variant from a oneOf/anyOf list:
 *  object-with-properties > non-null > first. Skips `type: "null"` entries
 *  introduced by 3.1 nullable shorthand. */
function pickPreferredVariant(variants: OpenAPIV3.SchemaObject[]): OpenAPIV3.SchemaObject {
  const isNull = (s: OpenAPIV3.SchemaObject) =>
    (s as { type?: unknown }).type === "null";
  const nonNull = variants.filter(v => !isNull(v));
  const pool = nonNull.length > 0 ? nonNull : variants;

  const objectWithProps = pool.find(
    v => v.type === "object" && v.properties && Object.keys(v.properties).length > 0,
  );
  if (objectWithProps) return objectWithProps;

  return pool[0]!;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A string example shaped like a UUID, on a field that looks like a foreign
 *  key (name ends with `_id` or schema declares `format: uuid`), is almost
 *  always a tenant-specific value the spec author left in `example:`. Sending
 *  it verbatim guarantees 422 on a fresh account and leaks foreign IDs. */
function isLikelyForeignFKExample(
  schema: OpenAPIV3.SchemaObject,
  name?: string,
): boolean {
  const ex = schema.example;
  if (typeof ex !== "string") return false;
  if (!UUID_RE.test(ex)) return false;
  const fkByName = !!name && name.toLowerCase().endsWith("_id");
  const fkByFormat = schema.format === "uuid";
  return fkByName || fkByFormat;
}

/**
 * Map an OpenAPI `format` value to a zond generator placeholder. Returns
 * undefined when the format is unknown or absent so callers can fall back
 * to type / property-name heuristics. Exported for tests.
 */
export function formatToPlaceholder(format: string | undefined): string | undefined {
  switch (format) {
    case "email": return "{{$randomEmail}}";
    case "uuid": return "{{$uuid}}";
    case "date-time": return "{{$randomIsoDate}}";
    case "date": return "{{$randomDate}}";
    case "uri":
    case "url": return "{{$randomUrl}}";
    case "hostname": return "{{$randomFqdn}}";
    case "ipv4": return "{{$randomIpv4}}";
    case "ipv6": return "::1";
    case "password": return "TestPass123!";
    default: return undefined;
  }
}

/**
 * Generate a multipart body object from an OpenAPI multipart/form-data schema.
 * Binary fields (format: binary/byte) become file upload objects; all others become strings.
 */
export function generateMultipartFromSchema(
  schema: OpenAPIV3.SchemaObject,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (!schema.properties) return result;

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const s = propSchema as OpenAPIV3.SchemaObject;
    if (s.format === "binary" || s.format === "byte") {
      result[key] = { file: `./fixtures/${key}.bin`, content_type: "application/octet-stream" };
    } else {
      const val = generateFromSchema(s, key);
      result[key] = val;
    }
  }

  return result;
}

function guessStringPlaceholder(schema: OpenAPIV3.SchemaObject, name?: string): string {
  // Format-based dispatch already happened earlier in generateFromSchema;
  // this branch only sees strings whose format is empty or unrecognised.

  // Name-based heuristics
  if (name) {
    const lower = name.toLowerCase();
    // Email-context fields. Email-API specs (Resend, SendGrid, Mailgun) often
    // omit `format: email` on `from`/`to`/`reply_to`/`cc`/`bcc` — the field
    // name is the only clue, and `{{$randomString}}` guarantees a 422.
    if (
      lower === "email" ||
      lower === "from" ||
      lower === "to" ||
      lower === "cc" ||
      lower === "bcc" ||
      lower === "sender" ||
      lower === "recipient" ||
      lower === "reply_to" ||
      lower === "replyto" ||
      lower.endsWith("_email") ||
      lower.endsWith("Email") ||
      lower.endsWith("_reply_to") ||
      lower.endsWith("_from") ||
      lower.endsWith("_to") ||
      lower.endsWith("_cc") ||
      lower.endsWith("_bcc")
    ) {
      return "{{$randomEmail}}";
    }
    if (lower === "id" || lower === "uuid" || lower.endsWith("_id") || lower.endsWith("id")) {
      return "{{$uuid}}";
    }
    if (lower === "name" || lower.endsWith("_name") || lower.endsWith("Name")) {
      return "{{$randomName}}";
    }
    if (lower === "url" || lower.endsWith("_url") || lower === "uri" || lower === "href" || lower === "website") {
      return "{{$randomUrl}}";
    }
    if (lower === "password" || lower.endsWith("_password")) {
      return "TestPass123!";
    }
    if (lower === "phone" || lower === "telephone" || lower.endsWith("_phone")) {
      return "+1234567890";
    }
  }

  return "{{$randomString}}";
}

function guessIntPlaceholder(name?: string, schema?: OpenAPIV3.SchemaObject): number | string {
  const min = schema?.minimum;
  const max = schema?.maximum;
  if (max !== undefined) {
    // Use a safe concrete value within the declared range
    const lo = min !== undefined && min > 0 ? min : 1;
    return Math.min(lo, max);
  }
  if (min !== undefined && min > 0) {
    return min;
  }
  return "{{$randomInt}}";
}
