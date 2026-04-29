import Ajv2020 from "ajv/dist/2020.js";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction, AnySchema } from "ajv";
import type { OpenAPIV3 } from "openapi-types";
import { specPathToRegex } from "../generator/coverage-scanner.ts";
import type { AssertionResult } from "./types.ts";

export interface SchemaValidator {
  validate(method: string, path: string, status: number, body: unknown): AssertionResult[];
}

interface EndpointEntry {
  method: string;
  path: string;
  regex: RegExp;
  responses: OpenAPIV3.ResponsesObject;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export function createSchemaValidator(doc: OpenAPIV3.Document): SchemaValidator {
  const isV31 = typeof doc.openapi === "string" && doc.openapi.startsWith("3.1");
  // OpenAPI 3.1 → JSON Schema Draft 2020-12; 3.0 → Draft 4/7-ish.
  const ajv = isV31
    ? new (Ajv2020 as unknown as typeof Ajv)({ strict: false, allErrors: true })
    : new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  const endpoints: EndpointEntry[] = [];
  if (doc.paths) {
    for (const [pathTpl, pathItem] of Object.entries(doc.paths)) {
      if (!pathItem) continue;
      const regex = specPathToRegex(pathTpl);
      for (const m of HTTP_METHODS) {
        const op = (pathItem as Record<string, unknown>)[m] as OpenAPIV3.OperationObject | undefined;
        if (!op || !op.responses) continue;
        endpoints.push({ method: m.toUpperCase(), path: pathTpl, regex, responses: op.responses });
      }
    }
  }

  const compiled = new Map<unknown, ValidateFunction>();
  function compile(schema: AnySchema): ValidateFunction {
    const cached = compiled.get(schema);
    if (cached) return cached;
    const prepared = isV31 ? schema : convertOpenApi30(schema);
    const fn = ajv.compile(prepared as AnySchema);
    compiled.set(schema, fn);
    return fn;
  }

  function findResponseSchema(method: string, path: string, status: number): OpenAPIV3.SchemaObject | undefined {
    const upper = method.toUpperCase();
    // Match path; first match wins. Concrete paths (no {param}) sort before
    // templated ones so /users/me wins over /users/{id}.
    const match = endpoints.find(e => e.method === upper && e.regex.test(path));
    if (!match) return undefined;
    const responses = match.responses;
    const exact = responses[String(status)] as OpenAPIV3.ResponseObject | undefined;
    const wildcard = responses[`${Math.floor(status / 100)}XX`] as OpenAPIV3.ResponseObject | undefined;
    const fallback = responses.default as OpenAPIV3.ResponseObject | undefined;
    const response = exact ?? wildcard ?? fallback;
    if (!response || !response.content) return undefined;
    const json = response.content["application/json"];
    return (json?.schema as OpenAPIV3.SchemaObject | undefined) ?? undefined;
  }

  return {
    validate(method, path, status, body) {
      const schema = findResponseSchema(method, path, status);
      if (!schema) return [];
      let validator: ValidateFunction;
      try {
        validator = compile(schema);
      } catch (err) {
        return [{
          field: "body",
          rule: "schema.compile_error",
          passed: false,
          actual: undefined,
          expected: err instanceof Error ? err.message : String(err),
        }];
      }
      const ok = validator(body);
      if (ok) return [];
      const errors = validator.errors ?? [];
      return errors.map(e => ajvErrorToAssertion(e, body));
    },
  };
}

function ajvErrorToAssertion(err: ErrorObject, body: unknown): AssertionResult {
  const ptr = err.instancePath || "";
  // Field key like "body" or "body.user.email" for parity with checkAssertions.
  const field = ptr ? `body${ptr.replace(/\//g, ".")}` : "body";
  const actual = ptr ? getByJsonPointer(body, ptr) : body;
  return {
    field,
    rule: `schema.${err.keyword}`,
    passed: false,
    actual,
    expected: humanize(err),
  };
}

function humanize(err: ErrorObject): string {
  switch (err.keyword) {
    case "required":
      return `required: "${(err.params as { missingProperty: string }).missingProperty}"`;
    case "type":
      return `type ${(err.params as { type: string | string[] }).type}`;
    case "enum":
      return `one of ${JSON.stringify((err.params as { allowedValues: unknown[] }).allowedValues)}`;
    case "format":
      return `format "${(err.params as { format: string }).format}"`;
    case "additionalProperties":
      return `no additional property "${(err.params as { additionalProperty: string }).additionalProperty}"`;
    case "const":
      return `const ${JSON.stringify((err.params as { allowedValue: unknown }).allowedValue)}`;
    case "minLength":
    case "maxLength":
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
    case "multipleOf":
    case "pattern":
      return `${err.keyword} ${JSON.stringify((err.params as Record<string, unknown>)[err.keyword] ?? "")}`.trim();
    default:
      return err.message ?? err.keyword;
  }
}

function getByJsonPointer(obj: unknown, pointer: string): unknown {
  if (!pointer) return obj;
  const segments = pointer.split("/").slice(1).map(s => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Convert OpenAPI 3.0 schema to JSON Schema Draft 7-compatible:
 * - `nullable: true` → add "null" to `type`.
 * - Drop unsupported `example`, `xml`, `discriminator` keywords (ajv tolerates with strict:false).
 */
function convertOpenApi30(schema: AnySchema): AnySchema {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    return schema.map(s => convertOpenApi30(s as AnySchema)) as unknown as AnySchema;
  }
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "nullable") continue;
    if (k === "type" && src.nullable === true) {
      if (Array.isArray(v)) {
        out.type = [...v as unknown[], "null"];
      } else if (typeof v === "string") {
        out.type = [v, "null"];
      } else {
        out.type = v;
      }
      continue;
    }
    if (v && typeof v === "object") {
      out[k] = convertOpenApi30(v as AnySchema);
    } else {
      out[k] = v;
    }
  }
  // Standalone nullable: true with no explicit type → leave as-is (ajv accepts any).
  return out as AnySchema;
}
