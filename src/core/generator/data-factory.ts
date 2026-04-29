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
  if (schema.example !== undefined) {
    return schema.example;
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

  // oneOf / anyOf: use first variant
  if (schema.oneOf) {
    return generateFromSchema(schema.oneOf[0] as OpenAPIV3.SchemaObject, propertyName, _depth + 1);
  }
  if (schema.anyOf) {
    return generateFromSchema(schema.anyOf[0] as OpenAPIV3.SchemaObject, propertyName, _depth + 1);
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
    if (lower === "email" || lower.endsWith("_email") || lower.endsWith("Email")) {
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
