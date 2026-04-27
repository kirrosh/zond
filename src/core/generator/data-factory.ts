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

  // enum: first value
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  // uuid format overrides type (e.g. integer fields with format: uuid)
  if (schema.format === "uuid") return "{{$uuid}}";

  switch (schema.type) {
    case "string":
      return guessStringPlaceholder(schema, propertyName);

    case "integer":
      return guessIntPlaceholder(propertyName, schema);

    case "number":
      return 29.99;

    case "boolean":
      return true;

    case "array": {
      if (schema.items) {
        const item = generateFromSchema(schema.items as OpenAPIV3.SchemaObject, undefined, _depth + 1);
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
      if (schema.type === "object") {
        return {};
      }
      return "{{$randomString}}";
    }
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
  // Format-based — emit generator placeholders so each call yields a fresh value
  if (schema.format === "email") return "{{$randomEmail}}";
  if (schema.format === "uuid") return "{{$uuid}}";
  if (schema.format === "date-time") return "{{$randomIsoDate}}";
  if (schema.format === "date") return "{{$randomDate}}";
  if (schema.format === "uri" || schema.format === "url") return "{{$randomUrl}}";
  if (schema.format === "hostname") return "{{$randomFqdn}}";
  if (schema.format === "ipv4") return "{{$randomIpv4}}";
  if (schema.format === "ipv6") return "::1";
  if (schema.format === "password") return "TestPass123!";

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
