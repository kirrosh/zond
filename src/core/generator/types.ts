import type { OpenAPIV3 } from "openapi-types";

export interface ResponseInfo {
  statusCode: number;
  description: string;
  schema?: OpenAPIV3.SchemaObject;
}

export interface EndpointInfo {
  path: string;
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
