import type { OpenAPIV3 } from "openapi-types";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export type SchemaContextKind =
  | "param-schema"
  | "request-body"
  | "response-body"
  | "property";

export interface ParamContext {
  kind: "parameter";
  jsonpointer: string;
  path: string;
  method: string;
  param: OpenAPIV3.ParameterObject;
}

export interface ResponseContext {
  kind: "response";
  jsonpointer: string;
  path: string;
  method: string;
  status: string;
  response: OpenAPIV3.ResponseObject;
}

export interface RequestBodyContext {
  kind: "requestBody";
  jsonpointer: string;
  path: string;
  method: string;
  requestBody: OpenAPIV3.RequestBodyObject;
}

export interface SchemaContext {
  kind: "schema";
  jsonpointer: string;
  path?: string;
  method?: string;
  origin: SchemaContextKind;
  /** Property name if this schema is a value of `properties.<name>`. */
  propertyName?: string;
  schema: OpenAPIV3.SchemaObject;
}

export type WalkContext = ParamContext | ResponseContext | RequestBodyContext | SchemaContext;

export type Visitor = (ctx: WalkContext) => void;

/**
 * RFC6901 segment encoder: `~` → `~0`, `/` → `~1`.
 */
export function escapePointerSegment(s: string | number): string {
  return String(s).replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Walk an OpenAPI 3.x document, invoking `visit` for parameters, request bodies,
 * responses, and every nested schema (recursively through properties / items /
 * combinators). Each call carries a stable RFC6901 jsonpointer so issues can
 * point precisely to the source.
 *
 * Cycles (already-visited schema objects by reference) are short-circuited so
 * `@readme/openapi-parser`-resolved $ref-cycles don't loop.
 */
export function walk(doc: OpenAPIV3.Document, visit: Visitor): void {
  if (!doc.paths) return;
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem) continue;
    const pathPtr = `/paths/${escapePointerSegment(path)}`;

    // Path-level parameters
    if (pathItem.parameters) {
      pathItem.parameters.forEach((p, idx) => {
        const param = p as OpenAPIV3.ParameterObject;
        const ptr = `${pathPtr}/parameters/${idx}`;
        visit({ kind: "parameter", jsonpointer: ptr, path, method: "*", param });
        if (param.schema) {
          walkSchema(
            param.schema as OpenAPIV3.SchemaObject,
            `${ptr}/schema`,
            { origin: "param-schema", path, method: "*" },
            visit,
            new Set(),
          );
        }
      });
    }

    for (const m of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[m] as OpenAPIV3.OperationObject | undefined;
      if (!op) continue;
      const opPtr = `${pathPtr}/${m}`;
      const method = m.toUpperCase();

      // Operation-level parameters
      if (op.parameters) {
        op.parameters.forEach((p, idx) => {
          const param = p as OpenAPIV3.ParameterObject;
          const ptr = `${opPtr}/parameters/${idx}`;
          visit({ kind: "parameter", jsonpointer: ptr, path, method, param });
          if (param.schema) {
            walkSchema(
              param.schema as OpenAPIV3.SchemaObject,
              `${ptr}/schema`,
              { origin: "param-schema", path, method },
              visit,
              new Set(),
            );
          }
        });
      }

      // Request body
      if (op.requestBody) {
        const rb = op.requestBody as OpenAPIV3.RequestBodyObject;
        const rbPtr = `${opPtr}/requestBody`;
        visit({ kind: "requestBody", jsonpointer: rbPtr, path, method, requestBody: rb });
        if (rb.content) {
          for (const [ct, mt] of Object.entries(rb.content)) {
            if (mt.schema) {
              walkSchema(
                mt.schema as OpenAPIV3.SchemaObject,
                `${rbPtr}/content/${escapePointerSegment(ct)}/schema`,
                { origin: "request-body", path, method },
                visit,
                new Set(),
              );
            }
          }
        }
      }

      // Responses
      if (op.responses) {
        for (const [status, respObj] of Object.entries(op.responses)) {
          const resp = respObj as OpenAPIV3.ResponseObject;
          const respPtr = `${opPtr}/responses/${escapePointerSegment(status)}`;
          visit({ kind: "response", jsonpointer: respPtr, path, method, status, response: resp });
          if (resp.content) {
            for (const [ct, mt] of Object.entries(resp.content)) {
              if (mt.schema) {
                walkSchema(
                  mt.schema as OpenAPIV3.SchemaObject,
                  `${respPtr}/content/${escapePointerSegment(ct)}/schema`,
                  { origin: "response-body", path, method },
                  visit,
                  new Set(),
                );
              }
            }
          }
        }
      }
    }
  }
}

interface WalkSchemaCtx {
  origin: SchemaContextKind;
  path?: string;
  method?: string;
  propertyName?: string;
}

function walkSchema(
  schema: OpenAPIV3.SchemaObject,
  pointer: string,
  ctx: WalkSchemaCtx,
  visit: Visitor,
  visited: Set<unknown>,
): void {
  if (!schema || typeof schema !== "object") return;
  if (visited.has(schema)) return;
  visited.add(schema);

  visit({
    kind: "schema",
    jsonpointer: pointer,
    path: ctx.path,
    method: ctx.method,
    origin: ctx.origin,
    propertyName: ctx.propertyName,
    schema,
  });

  if (schema.properties) {
    for (const [name, sub] of Object.entries(schema.properties)) {
      walkSchema(
        sub as OpenAPIV3.SchemaObject,
        `${pointer}/properties/${escapePointerSegment(name)}`,
        { origin: "property", path: ctx.path, method: ctx.method, propertyName: name },
        visit,
        visited,
      );
    }
  }

  const arraySchema = schema as OpenAPIV3.ArraySchemaObject;
  if (arraySchema.items) {
    walkSchema(
      arraySchema.items as OpenAPIV3.SchemaObject,
      `${pointer}/items`,
      { ...ctx, propertyName: undefined },
      visit,
      visited,
    );
  }

  for (const combinator of ["allOf", "anyOf", "oneOf"] as const) {
    const arr = (schema as Record<string, unknown>)[combinator] as OpenAPIV3.SchemaObject[] | undefined;
    if (Array.isArray(arr)) {
      arr.forEach((sub, idx) => {
        walkSchema(
          sub,
          `${pointer}/${combinator}/${idx}`,
          { ...ctx, propertyName: undefined },
          visit,
          visited,
        );
      });
    }
  }

  if (typeof schema.additionalProperties === "object" && schema.additionalProperties !== null) {
    walkSchema(
      schema.additionalProperties as OpenAPIV3.SchemaObject,
      `${pointer}/additionalProperties`,
      { ...ctx, propertyName: undefined },
      visit,
      visited,
    );
  }
}

/**
 * Normalise OpenAPI 3.0 `nullable: true` so callers can reason about a single
 * type list. Returns the (possibly array) type without mutating the schema.
 */
export function normalisedTypes(schema: OpenAPIV3.SchemaObject): string[] {
  const t = (schema as { type?: string | string[] }).type;
  const list: string[] = Array.isArray(t) ? [...t] : t ? [t] : [];
  if ((schema as { nullable?: boolean }).nullable === true && !list.includes("null")) {
    list.push("null");
  }
  return list;
}
