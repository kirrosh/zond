/**
 * ARV-175: group 2xx bodies by endpoint+status, infer, respect min-samples.
 */
import { describe, test, expect } from "bun:test";
import { schemaFromRuns, type ResultRow } from "../../../src/core/spec/schema-from-runs.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

function ep(method: string, path: string): EndpointInfo {
  return { method, path, operationId: `${method}${path}`, parameters: [], responses: {} } as unknown as EndpointInfo;
}

const ENDPOINTS = [ep("GET", "/v1/charges/{id}"), ep("GET", "/v1/charges")];

function row(method: string, url: string, status: number, body: unknown): ResultRow {
  return { request_method: method, request_url: url, response_status: status, response_body: JSON.stringify(body) };
}

describe("schemaFromRuns (ARV-175)", () => {
  test("groups 2xx bodies by endpoint+status and infers a schema", () => {
    const rows: ResultRow[] = [
      row("GET", "https://api.stripe.com/v1/charges/ch_1?expand=x", 200, { id: "ch_1", amount: 100 }),
      row("GET", "https://api.stripe.com/v1/charges/ch_2", 200, { id: "ch_2", amount: 200 }),
    ];
    const r = schemaFromRuns({ results: rows, endpoints: ENDPOINTS, minSamples: 2 });
    expect(r.patch["GET /v1/charges/{id}"]?.["200"]?.type).toBe("object");
    expect((r.patch["GET /v1/charges/{id}"]!["200"]!.required as string[]).sort()).toEqual(["amount", "id"]);
    expect(r.groups.find((g) => g.endpoint === "GET /v1/charges/{id}")?.emitted).toBe(true);
  });

  test("skips groups below min-samples with a reason", () => {
    const rows: ResultRow[] = [row("GET", "https://api.stripe.com/v1/charges/ch_1", 200, { id: "ch_1" })];
    const r = schemaFromRuns({ results: rows, endpoints: ENDPOINTS, minSamples: 2 });
    expect(r.patch["GET /v1/charges/{id}"]).toBeUndefined();
    const g = r.groups.find((x) => x.endpoint === "GET /v1/charges/{id}");
    expect(g?.emitted).toBe(false);
    expect(g?.reason).toContain("samples");
  });

  test("ignores non-2xx and non-JSON bodies", () => {
    const rows: ResultRow[] = [
      { request_method: "GET", request_url: "https://x/v1/charges/ch_1", response_status: 404, response_body: '{"e":1}' },
      { request_method: "GET", request_url: "https://x/v1/charges/ch_2", response_status: 200, response_body: "not json" },
    ];
    const r = schemaFromRuns({ results: rows, endpoints: ENDPOINTS, minSamples: 1 });
    expect(Object.keys(r.patch)).toHaveLength(0);
  });

  test("prefers the most specific path (fewest params)", () => {
    const eps = [ep("GET", "/users/{id}"), ep("GET", "/users/me")];
    const rows: ResultRow[] = [row("GET", "https://x/users/me", 200, { self: true })];
    const r = schemaFromRuns({ results: rows, endpoints: eps, minSamples: 1 });
    expect(r.patch["GET /users/me"]).toBeDefined();
    expect(r.patch["GET /users/{id}"]).toBeUndefined();
  });
});
