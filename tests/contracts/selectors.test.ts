/**
 * Unit tests for the unified operation filter (m-15 ARV-9).
 * AC #1: 20-row table over [operations, filter, expected_subset].
 * AC #2: e2e on the petstore fixture.
 * AC #4: malformed specs surface a friendly error, not a stack trace.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compileOperationFilter, parseFilterSpec } from "../../src/core/selectors/operation-filter.ts";
import type { EndpointInfo } from "../../src/core/generator/types.ts";
import { extractEndpoints, readOpenApiSpec } from "../../src/core/generator/index.ts";

function op(over: Partial<EndpointInfo>): EndpointInfo {
  return {
    path: over.path ?? "/x",
    method: over.method ?? "GET",
    operationId: over.operationId,
    summary: undefined,
    tags: over.tags ?? [],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
  };
}

const OPS: EndpointInfo[] = [
  op({ path: "/users", method: "GET", tags: ["users"], operationId: "listUsers" }),
  op({ path: "/users", method: "POST", tags: ["users"], operationId: "createUser" }),
  op({ path: "/users/{id}", method: "GET", tags: ["users"], operationId: "getUser" }),
  op({ path: "/users/{id}", method: "DELETE", tags: ["users"], operationId: "deleteUser" }),
  op({ path: "/orders", method: "GET", tags: ["billing"], operationId: "listOrders" }),
  op({ path: "/orders", method: "POST", tags: ["billing"], operationId: "createOrder" }),
  op({ path: "/orders/{id}/cancel", method: "POST", tags: ["billing"], operationId: "cancelOrder" }),
  op({ path: "/health", method: "GET", tags: ["system"], operationId: "health" }),
  op({ path: "/admin/reset", method: "POST", tags: ["system", "admin"], operationId: "adminReset" }),
  op({ path: "/legacy", method: "GET", tags: [], operationId: undefined }),
];

function ids(filter: (op: EndpointInfo) => boolean): string[] {
  return OPS.filter(filter).map((o) => `${o.method} ${o.path}`);
}

interface Row {
  name: string;
  includes?: string[];
  excludes?: string[];
  expected: string[];
}

const TABLE: Row[] = [
  // ── path selector ───────────────────────────────────────────────────
  {
    name: "path:/users.* — only /users routes",
    includes: ["path:^/users(/|$)"],
    expected: ["GET /users", "POST /users", "GET /users/{id}", "DELETE /users/{id}"],
  },
  {
    name: "path:/orders/.* — only nested order routes (excludes bare /orders)",
    includes: ["path:^/orders/"],
    expected: ["POST /orders/{id}/cancel"],
  },
  // ── method selector ─────────────────────────────────────────────────
  { name: "method:GET — only reads", includes: ["method:GET"], expected: ["GET /users", "GET /users/{id}", "GET /orders", "GET /health", "GET /legacy"] },
  { name: "method:POST,DELETE — writes only", includes: ["method:POST,DELETE"], expected: ["POST /users", "DELETE /users/{id}", "POST /orders", "POST /orders/{id}/cancel", "POST /admin/reset"] },
  { name: "method case-insensitive", includes: ["method:get"], expected: ["GET /users", "GET /users/{id}", "GET /orders", "GET /health", "GET /legacy"] },
  // ── tag selector ────────────────────────────────────────────────────
  { name: "tag:users", includes: ["tag:users"], expected: ["GET /users", "POST /users", "GET /users/{id}", "DELETE /users/{id}"] },
  { name: "tag:billing,system", includes: ["tag:billing,system"], expected: ["GET /orders", "POST /orders", "POST /orders/{id}/cancel", "GET /health", "POST /admin/reset"] },
  { name: "tag:admin (only one op carries it)", includes: ["tag:admin"], expected: ["POST /admin/reset"] },
  // ── operation-id selector ───────────────────────────────────────────
  { name: "operation-id:^get", includes: ["operation-id:^get"], expected: ["GET /users/{id}"] },
  { name: "operation-id:^list", includes: ["operationId:^list"], expected: ["GET /users", "GET /orders"] },
  { name: "operation-id ignores ops without an id", includes: ["operation-id:.*"], expected: ["GET /users", "POST /users", "GET /users/{id}", "DELETE /users/{id}", "GET /orders", "POST /orders", "POST /orders/{id}/cancel", "GET /health", "POST /admin/reset"] },
  // ── exclude semantics ───────────────────────────────────────────────
  { name: "exclude tag:system removes /health and /admin/reset", excludes: ["tag:system"], expected: ["GET /users", "POST /users", "GET /users/{id}", "DELETE /users/{id}", "GET /orders", "POST /orders", "POST /orders/{id}/cancel", "GET /legacy"] },
  { name: "exclude method:DELETE", excludes: ["method:DELETE"], expected: ["GET /users", "POST /users", "GET /users/{id}", "GET /orders", "POST /orders", "POST /orders/{id}/cancel", "GET /health", "POST /admin/reset", "GET /legacy"] },
  { name: "exclude path:^/admin", excludes: ["path:^/admin"], expected: ["GET /users", "POST /users", "GET /users/{id}", "DELETE /users/{id}", "GET /orders", "POST /orders", "POST /orders/{id}/cancel", "GET /health", "GET /legacy"] },
  // ── combined include + exclude ──────────────────────────────────────
  { name: "tag:billing minus method:POST → reads on billing", includes: ["tag:billing"], excludes: ["method:POST"], expected: ["GET /orders"] },
  { name: "include union: tag:users OR tag:system", includes: ["tag:users", "tag:system"], expected: ["GET /users", "POST /users", "GET /users/{id}", "DELETE /users/{id}", "GET /health", "POST /admin/reset"] },
  { name: "include union with exclude: users∪system minus DELETE", includes: ["tag:users", "tag:system"], excludes: ["method:DELETE"], expected: ["GET /users", "POST /users", "GET /users/{id}", "GET /health", "POST /admin/reset"] },
  // ── boundary cases ──────────────────────────────────────────────────
  { name: "no filters → identity", expected: OPS.map((o) => `${o.method} ${o.path}`) },
  { name: "include with zero matches → empty", includes: ["path:^/nothing$"], expected: [] },
  { name: "exclude that matches everything → empty", excludes: ["path:.*"], expected: [] },
  { name: "two excludes intersected", excludes: ["tag:system", "method:DELETE"], expected: ["GET /users", "POST /users", "GET /users/{id}", "GET /orders", "POST /orders", "POST /orders/{id}/cancel", "GET /legacy"] },
];

describe("AC#1 — operation-filter table (20 cases)", () => {
  for (const row of TABLE) {
    test(row.name, () => {
      const { filter, errors } = compileOperationFilter({ includes: row.includes, excludes: row.excludes });
      expect(errors).toEqual([]);
      expect(ids(filter)).toEqual(row.expected);
    });
  }

  test("table covers at least 20 cases", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(20);
  });
});

describe("AC#4 — friendly errors on malformed specs", () => {
  test("missing colon", () => {
    const r = parseFilterSpec("usersOnly");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/expected "<selector>:<value>"/);
  });

  test("unknown selector", () => {
    const r = parseFilterSpec("foo:bar");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown selector "foo"/);
  });

  test("invalid regex", () => {
    const r = parseFilterSpec("path:[unterminated");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid regex/);
  });

  test("empty value", () => {
    const r = parseFilterSpec("tag:");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/value is empty/);
  });

  test("compileOperationFilter accumulates errors instead of throwing", () => {
    const { errors } = compileOperationFilter({
      includes: ["foo:bar", "method:GET"],
      excludes: ["path:[bad"],
    });
    expect(errors.length).toBe(2);
    expect(errors[0]).toMatch(/unknown selector/);
    expect(errors[1]).toMatch(/invalid regex/);
  });
});

describe("AC#2 — e2e on the petstore fixture", () => {
  test("tag + method + path filters resolve real petstore ops", async () => {
    const specPath = resolve(import.meta.dir, "../fixtures/petstore-simple.json");
    const doc = await readOpenApiSpec(specPath);
    const ops = extractEndpoints(doc);

    // Sanity: petstore-simple has the canonical operations we count on.
    const allIds = ops.map((o) => `${o.method.toUpperCase()} ${o.path}`);
    expect(allIds.length).toBeGreaterThan(0);

    // path-only include: keeps every method on /pets paths.
    const { filter: petPaths } = compileOperationFilter({ includes: ["path:^/pets"] });
    const petIds = ops.filter(petPaths).map((o) => o.path);
    expect(petIds.length).toBeGreaterThan(0);
    for (const p of petIds) expect(p.startsWith("/pets")).toBe(true);

    // path:/pets ∧ method:GET requires composing one include + one
    // exclude: include path then exclude all non-GET methods.
    const { filter: petReads } = compileOperationFilter({
      includes: ["path:^/pets"],
      excludes: ["method:POST,PUT,PATCH,DELETE"],
    });
    for (const o of ops.filter(petReads)) {
      expect(o.path.startsWith("/pets")).toBe(true);
      expect(o.method.toUpperCase()).toBe("GET");
    }

    const { filter: noPosts } = compileOperationFilter({ excludes: ["method:POST"] });
    const noPostIds = ops.filter(noPosts).map((o) => o.method.toUpperCase());
    expect(noPostIds.includes("POST")).toBe(false);
  });
});
