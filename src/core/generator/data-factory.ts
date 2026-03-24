import type { OpenAPIV3 } from "openapi-types";

/**
 * Recursively generates test data from an OpenAPI schema.
 * Uses heuristic placeholders ({{$...}} generators) where possible.
 */
export function generateFromSchema(
  schema: OpenAPIV3.SchemaObject,
  propertyName?: string,
): unknown {
  // allOf: merge all schemas
  if (schema.allOf) {
    const merged: OpenAPIV3.SchemaObject = { type: "object", properties: {} };
    for (const sub of schema.allOf) {
      const s = sub as OpenAPIV3.SchemaObject;
      if (s.properties) {
        merged.properties = { ...merged.properties, ...s.properties };
      }
    }
    return generateFromSchema(merged, propertyName);
  }

  // oneOf / anyOf: use first variant
  if (schema.oneOf) {
    return generateFromSchema(schema.oneOf[0] as OpenAPIV3.SchemaObject, propertyName);
  }
  if (schema.anyOf) {
    return generateFromSchema(schema.anyOf[0] as OpenAPIV3.SchemaObject, propertyName);
  }

  // enum: first value
  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

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
        const item = generateFromSchema(schema.items as OpenAPIV3.SchemaObject);
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
          obj[key] = generateFromSchema(propSchema as OpenAPIV3.SchemaObject, key);
        }
        return obj;
      }
      // Record type: additionalProperties defines value schema
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        const valSchema = schema.additionalProperties as OpenAPIV3.SchemaObject;
        return { key1: generateFromSchema(valSchema, "key1"), key2: generateFromSchema(valSchema, "key2") };
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

function guessStringPlaceholder(schema: OpenAPIV3.SchemaObject, name?: string): string {
  // Format-based
  if (schema.format === "email") return "{{$randomEmail}}";
  if (schema.format === "uuid") return "{{$uuid}}";
  if (schema.format === "date-time" || schema.format === "date") return "2025-01-01T00:00:00Z";
  if (schema.format === "uri" || schema.format === "url") return "https://example.com/test";
  if (schema.format === "hostname") return "example.com";
  if (schema.format === "ipv4") return "192.168.1.1";
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
      return "https://example.com/test";
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
  if (schema?.minimum !== undefined && schema.minimum > 0) {
    return schema.minimum;
  }
  return "{{$randomInt}}";
}
