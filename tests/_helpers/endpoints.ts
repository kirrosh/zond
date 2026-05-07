import type { EndpointInfo } from "../../src/core/generator/types";

export function ep(partial: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    path: "/x",
    method: "GET",
    operationId: undefined,
    summary: undefined,
    tags: [],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    deprecated: false,
    requiresEtag: false,
    ...partial,
  };
}

export function postEp(partial: Partial<EndpointInfo> = {}): EndpointInfo {
  return ep({
    method: "POST",
    requestBodyContentType: "application/json",
    responses: [{ statusCode: 201, description: "created" }],
    ...partial,
  });
}
