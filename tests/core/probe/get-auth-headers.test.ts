import { describe, expect, test } from "bun:test";
import { getAuthHeaders } from "../../../src/core/probe/shared.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../../src/core/generator/types.ts";

function ep(security: string[]): EndpointInfo {
  return {
    method: "get",
    path: "/x",
    operationId: "x",
    parameters: [],
    security,
  } as unknown as EndpointInfo;
}

const basic: SecuritySchemeInfo = { name: "basicAuth", type: "http", scheme: "basic" };
const bearer: SecuritySchemeInfo = { name: "bearerAuth", type: "http", scheme: "bearer" };
const apiKeyAuthz: SecuritySchemeInfo = {
  name: "apiKeyAuth", type: "apiKey", in: "header", apiKeyName: "Authorization",
};
const apiKeyX: SecuritySchemeInfo = {
  name: "apiKeyX", type: "apiKey", in: "header", apiKeyName: "X-API-Key",
};

describe("getAuthHeaders (ARV-147)", () => {
  test("prefers bearer over basic when both are declared (Stripe v1 pattern)", () => {
    const result = getAuthHeaders(ep(["basicAuth", "bearerAuth"]), [basic, bearer]);
    expect(result).toEqual({ Authorization: "Bearer {{auth_token}}" });
  });

  test("still picks bearer regardless of declaration order", () => {
    const result = getAuthHeaders(ep(["bearerAuth", "basicAuth"]), [basic, bearer]);
    expect(result).toEqual({ Authorization: "Bearer {{auth_token}}" });
  });

  test("falls back to basic when nothing else matches", () => {
    const result = getAuthHeaders(ep(["basicAuth"]), [basic]);
    expect(result).toEqual({ Authorization: "Basic {{auth_token}}" });
  });

  test("prefers apiKey-via-Authorization over basic", () => {
    const result = getAuthHeaders(ep(["basicAuth", "apiKeyAuth"]), [basic, apiKeyAuthz]);
    expect(result).toEqual({ Authorization: "Bearer {{auth_token}}" });
  });

  test("prefers custom-header apiKey over basic", () => {
    const result = getAuthHeaders(ep(["basicAuth", "apiKeyX"]), [basic, apiKeyX]);
    expect(result).toEqual({ "X-API-Key": "{{api_key}}" });
  });

  test("returns undefined when endpoint declares no security", () => {
    expect(getAuthHeaders(ep([]), [bearer])).toBeUndefined();
  });
});
