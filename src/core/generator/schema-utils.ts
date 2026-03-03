import type { OpenAPIV3 } from "openapi-types";

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
