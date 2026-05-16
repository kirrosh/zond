/**
 * Unit tests for `pagination_invariants` (m-20 ARV-171, ARV-220 page-style).
 *
 * Stubbed harness drives [GET page A, GET page B] tuples so each
 * verdict is exercised deterministically.
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import { paginationInvariants } from "../../../src/core/checks/checks/pagination_invariants.ts";
import type { StatefulHarness } from "../../../src/core/checks/stateful.ts";
import type { CrudGroup, EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpResponse, HttpRequest } from "../../../src/core/runner/types.ts";
import type { PaginationConfig } from "../../../src/core/generator/resources-builder.ts";

function makeList(over: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    path: "/customers",
    method: "GET",
    operationId: "list_customers",
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
    resource: "customer",
    basePath: "/customers",
    itemPath: "/customers/{customer_id}",
    idParam: "customer_id",
    list,
  };
}

function r2xx(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body), body_parsed: body, duration_ms: 1 };
}

function rStatus(status: number): HttpResponse {
  return { status, headers: {}, body: "", duration_ms: 1 };
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

describe("pagination_invariants — stateful check", () => {
  test("opts out when no yaml and no cursor query param", async () => {
    const g = makeGroup(makeList());
    const h = stubHarness([]);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/no pagination config/);
  });

  test("offset-style yaml short-circuits with explicit reason (not implemented)", async () => {
    const cfg = new Map([["customer", { pagination: { type: "offset" } as PaginationConfig }]]);
    const g = makeGroup(makeList());
    const h = stubHarness([], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/not implemented/);
  });

  test("passes when consecutive pages are disjoint and has_more agrees", async () => {
    const cfg = new Map([["customer", { pagination: {} as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "c_1" }, { id: "c_2" }], has_more: true }),
      r2xx({ data: [{ id: "c_3" }, { id: "c_4" }], has_more: true }),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("pass");
    // 2nd request must carry the cursor for c_2 (last id of page A).
    expect(h.calls[1]!.req.url).toContain("starting_after=c_2");
  });

  test("fails when page B contains items from page A (duplicate)", async () => {
    const cfg = new Map([["customer", { pagination: {} as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "c_1" }, { id: "c_2" }], has_more: true }),
      r2xx({ data: [{ id: "c_2" }, { id: "c_3" }], has_more: true }), // c_2 reappears
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("duplicate_items");
      expect(out.evidence?.duplicates).toEqual(["c_2"]);
    }
  });

  test("fails when has_more=true on A but B empty without has_more=false", async () => {
    const cfg = new Map([["customer", { pagination: {} as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "c_1" }, { id: "c_2" }], has_more: true }),
      r2xx({ data: [], has_more: true }), // page B empty BUT still claims more
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.evidence?.kind).toContain("has_more_inconsistent");
  });

  test("fails when page A is partial (size < limit) yet advertises has_more=true", async () => {
    const cfg = new Map([["customer", { pagination: { defaultLimit: 5 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "c_1" }, { id: "c_2" }], has_more: true }), // only 2 of 5 returned
      r2xx({ data: [{ id: "c_3" }], has_more: false }),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.evidence?.kind).toContain("partial_page_with_has_more");
  });

  test("skips on 5xx broken baseline", async () => {
    const cfg = new Map([["customer", { pagination: {} as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([rStatus(500)], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/page A returned 500/);
  });

  test("skips on empty page A", async () => {
    const cfg = new Map([["customer", { pagination: {} as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([r2xx({ data: [], has_more: false })], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/empty/);
  });

  test("auto-detects cursor query param without yaml", async () => {
    const g = makeGroup(makeList({
      parameters: [{ name: "cursor", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "a" }, { id: "b" }] }),
      r2xx({ data: [{ id: "c" }, { id: "d" }] }),
    ]);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls[1]!.req.url).toContain("cursor=b");
  });

  // ── ARV-220: page-number style (GitHub/GitLab/Atlassian) ────────

  test("page-style: disjoint pages with per_page respected → pass", async () => {
    const cfg = new Map([["customer", { pagination: { type: "page", defaultLimit: 2 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [
        { name: "page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject,
        { name: "per_page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject,
      ],
    }));
    const h = stubHarness([
      r2xx([{ id: "i1" }, { id: "i2" }]),
      r2xx([{ id: "i3" }, { id: "i4" }]),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls[0]!.req.url).toContain("page=1");
    expect(h.calls[0]!.req.url).toContain("per_page=2");
    expect(h.calls[1]!.req.url).toContain("page=2");
  });

  test("page-style: page 2 contains page 1 items → fail duplicate_items", async () => {
    const cfg = new Map([["customer", { pagination: { type: "page", defaultLimit: 2 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ data: [{ id: "i1" }, { id: "i2" }] }),
      r2xx({ data: [{ id: "i2" }, { id: "i3" }] }), // i2 reappears — off-by-one
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("duplicate_items");
      expect(out.evidence?.style).toBe("page");
      expect(out.evidence?.duplicates).toEqual(["i2"]);
    }
  });

  test("page-style: server returns more than per_page → fail per_page_exceeded", async () => {
    const cfg = new Map([["customer", { pagination: { type: "page", defaultLimit: 2 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ items: [{ id: "i1" }, { id: "i2" }, { id: "i3" }, { id: "i4" }, { id: "i5" }] }),
      r2xx({ items: [{ id: "i6" }] }),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("per_page_exceeded");
      expect(out.evidence?.page_a_size).toBe(5);
    }
  });

  test("page-style: empty page B (natural end of list) → pass", async () => {
    const cfg = new Map([["customer", { pagination: { type: "page", defaultLimit: 2 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx([{ id: "i1" }, { id: "i2" }]),
      r2xx([]),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("pass");
  });

  test("page-style: start_page=0 honored for 0-based APIs", async () => {
    const cfg = new Map([["customer", { pagination: { type: "page", startPage: 0, defaultLimit: 2 } as PaginationConfig }]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx([{ id: "i1" }, { id: "i2" }]),
      r2xx([{ id: "i3" }]),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls[0]!.req.url).toContain("page=0");
    expect(h.calls[1]!.req.url).toContain("page=1");
  });

  test("page-style: auto-detects `page` query param without yaml", async () => {
    const g = makeGroup(makeList({
      parameters: [{ name: "page", in: "query", schema: { type: "integer" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx([{ id: "a" }, { id: "b" }]),
      r2xx([{ id: "c" }, { id: "d" }]),
    ]);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls[0]!.req.url).toContain("page=1");
    expect(h.calls[0]!.req.url).toContain("per_page=2");
  });

  test("page-style: custom page_param + limit_param honored", async () => {
    const cfg = new Map([["customer", { pagination: { type: "page", pageParam: "p", limitParam: "size", defaultLimit: 3 } as PaginationConfig }]]);
    const g = makeGroup(makeList());
    const h = stubHarness([
      r2xx([{ id: "x1" }, { id: "x2" }, { id: "x3" }]),
      r2xx([{ id: "x4" }]),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls[0]!.req.url).toContain("p=1");
    expect(h.calls[0]!.req.url).toContain("size=3");
  });

  test("custom items_field is honored", async () => {
    const cfg = new Map([[
      "customer",
      { pagination: { itemsField: "results", cursorField: "uid" } as PaginationConfig },
    ]]);
    const g = makeGroup(makeList({
      parameters: [{ name: "starting_after", in: "query", schema: { type: "string" } } as OpenAPIV3.ParameterObject],
    }));
    const h = stubHarness([
      r2xx({ results: [{ uid: "x1" }, { uid: "x2" }] }),
      r2xx({ results: [{ uid: "x3" }] }),
    ], cfg);
    const out = await paginationInvariants.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls[1]!.req.url).toContain("starting_after=x2");
  });
});
