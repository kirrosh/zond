/**
 * Unit tests for `x-zond-*` vendor-extension policy (ARV-189, m-21).
 *
 * Covers the pure policy module (endpointSkipsCheck / reasonForSkip)
 * plus the extension extraction in openapi-reader so callers know the
 * end-to-end shape.
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import {
  endpointSkipsCheck,
  reasonForSkip,
} from "../../../src/core/checks/zond-extensions.ts";
import { extractEndpoints } from "../../../src/core/generator/openapi-reader.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

function ep(extensions?: Record<string, unknown>): EndpointInfo {
  return {
    path: "/widgets",
    method: "GET",
    tags: [],
    parameters: [],
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    extensions,
  };
}

describe("endpointSkipsCheck — pure policy", () => {
  test("no extensions → never skips", () => {
    expect(endpointSkipsCheck(ep(), "ignored_auth")).toBe(false);
    expect(endpointSkipsCheck(ep(undefined), "any_check_id")).toBe(false);
  });

  test("x-zond-skip as string array: matching id → skip", () => {
    const e = ep({ "x-zond-skip": ["ignored_auth", "missing_required_header"] });
    expect(endpointSkipsCheck(e, "ignored_auth")).toBe(true);
    expect(endpointSkipsCheck(e, "missing_required_header")).toBe(true);
    expect(endpointSkipsCheck(e, "schema_conformance")).toBe(false);
  });

  test("x-zond-skip as single string (not array) is honored", () => {
    const e = ep({ "x-zond-skip": "ignored_auth" });
    expect(endpointSkipsCheck(e, "ignored_auth")).toBe(true);
    expect(endpointSkipsCheck(e, "schema_conformance")).toBe(false);
  });

  test("x-zond-public: true skips auth-class checks", () => {
    const e = ep({ "x-zond-public": true });
    expect(endpointSkipsCheck(e, "ignored_auth")).toBe(true);
    expect(endpointSkipsCheck(e, "missing_required_header")).toBe(true);
    // Non-auth checks are NOT affected by x-zond-public.
    expect(endpointSkipsCheck(e, "schema_conformance")).toBe(false);
    expect(endpointSkipsCheck(e, "status_code_conformance")).toBe(false);
  });

  test("x-zond-public: false has no effect", () => {
    const e = ep({ "x-zond-public": false });
    expect(endpointSkipsCheck(e, "ignored_auth")).toBe(false);
  });

  test("x-zond-skip and x-zond-public combine (either triggers skip)", () => {
    const e = ep({
      "x-zond-public": true,
      "x-zond-skip": ["schema_conformance"],
    });
    expect(endpointSkipsCheck(e, "ignored_auth")).toBe(true);          // via public
    expect(endpointSkipsCheck(e, "schema_conformance")).toBe(true);    // via skip
    expect(endpointSkipsCheck(e, "rate_limit_headers_absent")).toBe(false);
  });

  test("malformed x-zond-skip values are ignored without throwing", () => {
    const e = ep({ "x-zond-skip": 42 as unknown as string[] });
    expect(endpointSkipsCheck(e, "ignored_auth")).toBe(false);
    const e2 = ep({ "x-zond-skip": [42, null, "ok_check"] as unknown as string[] });
    expect(endpointSkipsCheck(e2, "ignored_auth")).toBe(false);
    expect(endpointSkipsCheck(e2, "ok_check")).toBe(true);
  });
});

describe("reasonForSkip — user-facing skip reasons", () => {
  test("x-zond-public path mentions auth suppression context", () => {
    const e = ep({ "x-zond-public": true });
    expect(reasonForSkip(e, "ignored_auth")).toMatch(/x-zond-public.*auth/);
  });

  test("x-zond-skip path quotes the offending check id", () => {
    const e = ep({ "x-zond-skip": ["schema_conformance"] });
    expect(reasonForSkip(e, "schema_conformance")).toContain("schema_conformance");
    expect(reasonForSkip(e, "schema_conformance")).toMatch(/spec level/);
  });
});

describe("extractEndpoints — x-* extensions are surfaced", () => {
  test("operation-level x-zond-* extensions land on EndpointInfo.extensions", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/health": {
          get: {
            "x-zond-public": true,
            "x-zond-skip": ["ignored_auth"],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    } as unknown as OpenAPIV3.Document;
    const eps = extractEndpoints(spec);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.extensions).toEqual({
      "x-zond-public": true,
      "x-zond-skip": ["ignored_auth"],
    });
  });

  test("path-item-level x-* extensions are inherited; operation wins on key collision", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          "x-zond-skip": ["from_path"],
          "x-zond-other": "path-value",
          get: {
            "x-zond-skip": ["from_operation"],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    } as unknown as OpenAPIV3.Document;
    const eps = extractEndpoints(spec);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.extensions).toEqual({
      "x-zond-skip": ["from_operation"], // operation wins
      "x-zond-other": "path-value",      // path-only key inherited
    });
  });

  test("endpoint without any x-* extensions has extensions undefined (no churn-y empty {})", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    } as unknown as OpenAPIV3.Document;
    const eps = extractEndpoints(spec);
    expect(eps[0]!.extensions).toBeUndefined();
  });
});
