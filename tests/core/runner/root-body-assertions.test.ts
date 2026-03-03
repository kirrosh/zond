import { describe, test, expect } from "bun:test";
import { checkAssertions, extractCaptures } from "../../../src/core/runner/assertions.ts";
import type { HttpResponse } from "../../../src/core/runner/types.ts";

function makeResponse(body: unknown, status = 200): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    body_parsed: body,
    duration_ms: 50,
  };
}

describe("_body root body assertions", () => {
  test("_body type: array for array response → pass", () => {
    const results = checkAssertions(
      { status: 200, body: { _body: { type: "array" } } },
      makeResponse([1, 2, 3]),
    );
    const bodyResult = results.find(r => r.field === "body._body");
    expect(bodyResult).toBeDefined();
    expect(bodyResult!.passed).toBe(true);
  });

  test("_body type: object for object response → pass", () => {
    const results = checkAssertions(
      { status: 200, body: { _body: { type: "object" } } },
      makeResponse({ id: 1 }),
    );
    const bodyResult = results.find(r => r.field === "body._body");
    expect(bodyResult!.passed).toBe(true);
  });

  test("_body type: array for object response → fail", () => {
    const results = checkAssertions(
      { status: 200, body: { _body: { type: "array" } } },
      makeResponse({ id: 1 }),
    );
    const bodyResult = results.find(r => r.field === "body._body");
    expect(bodyResult!.passed).toBe(false);
  });

  test("_body exists: true for non-empty body → pass", () => {
    const results = checkAssertions(
      { status: 200, body: { _body: { exists: true } } },
      makeResponse([]),
    );
    const bodyResult = results.find(r => r.field === "body._body");
    expect(bodyResult!.passed).toBe(true);
  });

  test("_body.length for array → checks length property", () => {
    const results = checkAssertions(
      { status: 200, body: { "_body.length": { gt: 0 } } },
      makeResponse([1, 2, 3]),
    );
    const bodyResult = results.find(r => r.field === "body._body.length");
    expect(bodyResult).toBeDefined();
    expect(bodyResult!.passed).toBe(true);
  });

  test("_body capture captures entire body", () => {
    const captures = extractCaptures(
      { _body: { capture: "all" } },
      [1, 2, 3],
    );
    expect(captures.all).toEqual([1, 2, 3]);
  });
});
