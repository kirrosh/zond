import type { OpenAPIV3 } from "openapi-types";

export interface ResponseInfo {
  statusCode: number;
  description: string;
  schema?: OpenAPIV3.SchemaObject;
}

export interface EndpointInfo {
  path: string;
  /** ARV-183: original spec path before ARV-40 path-param disambiguation
   *  renamed `{id}` → `{<resource>_id}`. Set only when a rename happened;
   *  unset means `path` is the original. Used by checks that look up
   *  `doc.paths[...]` by string equality (status_code_conformance,
   *  response_headers_conformance) — without this they miss the spec
   *  entry and either fire phantom findings (status_code) or silently
   *  skip (response_headers). */
  originalPath?: string;
  method: string;
  operationId?: string;
  summary?: string;
  tags: string[];
  parameters: OpenAPIV3.ParameterObject[];
  requestBodySchema?: OpenAPIV3.SchemaObject;
  requestBodyContentType?: string;
  responseContentTypes: string[];
  responses: ResponseInfo[];
  security: string[];
  deprecated?: boolean;
  requiresEtag?: boolean;
}

export interface SecuritySchemeInfo {
  name: string;
  type: "http" | "apiKey" | "oauth2" | "openIdConnect";
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  apiKeyName?: string;
}

export interface CrudGroup {
  resource: string;
  basePath: string;
  itemPath: string;
  idParam: string;
  create?: EndpointInfo;
  list?: EndpointInfo;
  read?: EndpointInfo;
  update?: EndpointInfo;
  delete?: EndpointInfo;
}

export interface GenerateOptions {
  specPath: string;
  outputDir: string;
}
