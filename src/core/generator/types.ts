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
}

export interface GenerateOptions {
  specPath: string;
  outputDir: string;
}
