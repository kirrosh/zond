import { describe, expect, test } from "bun:test";
import { liveAuthHeaders } from "../../../src/core/probe/shared.ts";
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

describe("liveAuthHeaders (ARV-148)", () => {
  test("prefers bearer over basic with auth_token present (Stripe v1 pattern)", () => {
    const result = liveAuthHeaders(
      ep(["basicAuth", "bearerAuth"]),
      [basic, bearer],
      { auth_token: "sk_test_abc" },
    );
    expect(result).toEqual({ Authorization: "Bearer sk_test_abc" });
  });

  test("declaration order doesn't matter", () => {
    const result = liveAuthHeaders(
      ep(["bearerAuth", "basicAuth"]),
      [basic, bearer],
      { auth_token: "sk_test_abc" },
    );
    expect(result).toEqual({ Authorization: "Bearer sk_test_abc" });
  });

  test("falls back to basic only when nothing else fits", () => {
    const result = liveAuthHeaders(
      ep(["basicAuth"]),
      [basic],
      { auth_token: "alice:secret" },
    );
    expect(result).toEqual({ Authorization: "Basic alice:secret" });
  });

  test("returns {} when ep declares no security", () => {
    expect(liveAuthHeaders(ep([]), [bearer], { auth_token: "x" })).toEqual({});
  });

  test("returns {} when auth_token is missing", () => {
    expect(liveAuthHeaders(ep(["bearerAuth"]), [bearer], {})).toEqual({});
  });
});
