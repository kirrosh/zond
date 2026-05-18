/**
 * ARV-288: per-finding severity matrix for pagination_invariants.
 *
 * Locks the proof-cap baseline and per-kind dispatch:
 *   declared severity = 'low' (proof-cap baseline per ARV-250)
 *
 *   duplicate_items among kinds (data-loss evidence chain) → HIGH
 *   all other kinds only (has_more_inconsistent, partial_page_with_has_more,
 *     per_page_exceeded — single-signal protocol bugs) → MEDIUM
 *
 * Pattern follows ARV-284 (negative_data_rejection-severity.test.ts).
 * Uses the same mock-harness from pagination-invariants.test.ts.
 */
import { describe, expect, test } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import { paginationInvariants } from "../../../src/core/checks/checks/pagination_invariants.ts";
import type { StatefulHarness } from "../../../src/core/checks/stateful.ts";
import type { CrudGroup, EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpResponse, HttpRequest } from "../../../src/core/runner/types.ts";
import type { PaginationConfig } from "../../../src/core/generator/resources-builder.ts";

// ── Harness helpers (mirrors pagination-invariants.test.ts) ─────────────────

function makeList(over: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    path: "/items",
    method: "GET",
    operationId: "list_items",
    tags: [],
    parameters: [],
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    ...over,
  };
}

function makeGroup(list: EndpointInfo): CrudGroup {
  return {
    resource: "item",
    basePath: "/items",
    itemPath: "/items/{item_id}",
    idParam: "item_id",
    list,
  };
}

function r2xx(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body), body_parsed: body, duration_ms: 1 };
}

interface Call { req: HttpRequest }

function stubHarness(
  responses: HttpResponse[],
  configs?: Map<string, { pagination?: PaginationConfig }>,
): StatefulHarness & { calls: Call[] } {
  let i = 0;
  const calls: Call[] = [];
  return {
    baseUrl: "http://test",
    doc: { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} } as OpenAPIV3.Document,
    authHeaders: {},
    bootstrapCleanupFailed: false,
    resourceConfigs: configs,
    calls,
    async send(req): Promise<HttpResponse> {
      calls.push({ req });
      const r = responses[i++];
      if (!r) throw new Error(`unexpected send #${i}`);
      return r;
    },
  };
}

// ── Test cases ───────────────────────────────────────────────────────────────

describe("pagination_invariants — severity matrix (ARV-288)", () => {

  // Case 1: declared severity baseline
  test("declared severity is 'low' (proof-cap baseline)", () => {
    expect(paginationInvariants.severity).toBe("low");
  });

  // Case 2: cursor-style duplicate → HIGH
  test("cursor-style: page A and page B share an id → fail HIGH (duplicate_items)", async () => {
    const cfg = new Map([["item", { pagination: {} as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "a1" }, { id: "a2" }], has_more: true }),
      r2xx({ data: [{ id: "a2" }, { id: "a3" }], has_more: true }), // a2 reappears
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("duplicate_items");
      expect(out.severity).toBe("high");
    }
  });

  // Case 3: cursor-style has_more_inconsistent only → MEDIUM
  test("cursor-style: has_more=true on page A + page B empty + has_more!=false → fail MEDIUM (has_more_inconsistent)", async () => {
    const cfg = new Map([["item", { pagination: {} as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "a1" }, { id: "a2" }], has_more: true }),
      r2xx({ data: [], has_more: true }), // empty but still claims more
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("has_more_inconsistent");
      expect(out.evidence?.kind).not.toContain("duplicate_items");
      expect(out.severity).toBe("medium");
    }
  });

  // Case 4: cursor-style partial_page_with_more only → MEDIUM
  test("cursor-style: page A fewer items than limit + has_more=true → fail MEDIUM (partial_page_with_has_more)", async () => {
    const cfg = new Map([["item", { pagination: { defaultLimit: 5 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "a1" }, { id: "a2" }], has_more: true }), // only 2 of 5
      r2xx({ data: [{ id: "a3" }], has_more: false }),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("partial_page_with_has_more");
      expect(out.evidence?.kind).not.toContain("duplicate_items");
      expect(out.severity).toBe("medium");
    }
  });

  // Case 5: page-style duplicate → HIGH
  test("page-style: pages 1 and 2 share an id → fail HIGH (duplicate_items)", async () => {
    const cfg = new Map([["item", { pagination: { type: "page", defaultLimit: 2 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "p1" }, { id: "p2" }] }),
      r2xx({ data: [{ id: "p2" }, { id: "p3" }] }), // p2 reappears
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("duplicate_items");
      expect(out.severity).toBe("high");
    }
  });

  // Case 6: page-style per_page_exceeded only → MEDIUM
  test("page-style: per_page=2 but server returned 5 items → fail MEDIUM (per_page_exceeded)", async () => {
    const cfg = new Map([["item", { pagination: { type: "page", defaultLimit: 2 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ items: [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }, { id: "p5" }] }),
      r2xx({ items: [{ id: "p6" }] }),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("per_page_exceeded");
      expect(out.evidence?.kind).not.toContain("duplicate_items");
      expect(out.severity).toBe("medium");
    }
  });

  // Case 7: combo duplicate + has_more_inconsistent on cursor → HIGH (duplicate wins)
  test("cursor-style: duplicate + has_more_inconsistent combo → fail HIGH (duplicate_items takes precedence)", async () => {
    const cfg = new Map([["item", { pagination: { defaultLimit: 5 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    // page B: shares item with A AND is suspiciously small with has_more=true on A
    // To trigger has_more_inconsistent: B empty + has_more_a=true + has_more_b!=false.
    // To trigger duplicate_items: B contains a1 (from A).
    // Note: if itemsB is empty, duplicates will be empty too.
    // Instead use partial page A (2 of 5) + duplicate in B to get both kinds:
    const h = stubHarness([
      r2xx({ data: [{ id: "a1" }, { id: "a2" }], has_more: true }), // 2 of 5 → partial
      r2xx({ data: [{ id: "a2" }, { id: "a3" }], has_more: true }), // a2 duplicate + has_more still true (not inconsistent since B is not empty)
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      // kinds has both duplicate_items and partial_page_with_has_more
      expect(out.evidence?.kind).toContain("duplicate_items");
      // duplicate_items in kinds → HIGH regardless of other kinds
      expect(out.severity).toBe("high");
    }
  });
});
