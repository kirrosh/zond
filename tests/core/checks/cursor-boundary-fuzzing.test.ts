/**
 * Unit tests for `cursor_boundary_fuzzing` (ARV-273).
 *
 * Stubbed harness so each verdict (5xx → HIGH, 2xx-on-bad-cursor → LOW,
 * all 4xx → pass, all 401/403 → skip) is reachable deterministically.
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import { cursorBoundaryFuzzing } from "../../../src/core/checks/checks/cursor_boundary_fuzzing.ts";
import type { StatefulHarness } from "../../../src/core/checks/stateful.ts";
import type { CrudGroup, EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpResponse, HttpRequest } from "../../../src/core/runner/types.ts";

function makeList(params: OpenAPIV3.ParameterObject[] = []): EndpointInfo {
  return {
    path: "/v1/items",
    method: "GET",
    operationId: "list_items",
    tags: [],
    parameters: params,
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
  };
}

function makeGroup(list: EndpointInfo): CrudGroup {
  return {
    resource: "items",
    basePath: "/v1/items",
    itemPath: "/v1/items/{item_id}",
    idParam: "item_id",
    list,
  };
}

function rs(status: number, body = ""): HttpResponse {
  return { status, headers: {}, body, duration_ms: 1 };
}

function stubHarness(responses: HttpResponse[]): StatefulHarness & { calls: HttpRequest[] } {
  let i = 0;
  const calls: HttpRequest[] = [];
  return {
    baseUrl: "http://test",
    doc: { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} } as OpenAPIV3.Document,
    authHeaders: {},
    bootstrapCleanupFailed: false,
    calls,
    async send(req): Promise<HttpResponse> {
      calls.push(req);
      const r = responses[i++];
      if (!r) throw new Error(`unexpected send #${i}`);
      return r;
    },
  };
}

const cursorParam = (name: string): OpenAPIV3.ParameterObject => ({
  name,
  in: "query",
  schema: { type: "string" },
});

describe("cursor_boundary_fuzzing — detection", () => {
  test("matches conventional cursor names", () => {
    for (const name of [
      "cursor", "starting_after", "ending_before", "after", "before",
      "page_token", "next_token", "continuation",
    ]) {
      const g = makeGroup(makeList([cursorParam(name)]));
      expect(cursorBoundaryFuzzing.applies(g)).toBe(true);
    }
  });

  test("ignores unrelated query params", () => {
    const g = makeGroup(makeList([{ name: "filter", in: "query", schema: { type: "string" } }]));
    expect(cursorBoundaryFuzzing.applies(g)).toBe(false);
  });

  test("skips when no list endpoint", () => {
    const g: CrudGroup = {
      resource: "x",
      basePath: "/x",
      itemPath: "/x/{id}",
      idParam: "id",
    };
    expect(cursorBoundaryFuzzing.applies(g)).toBe(false);
  });

  test("accepts untyped cursor schema (open spec)", () => {
    const g = makeGroup(makeList([{ name: "cursor", in: "query" } as OpenAPIV3.ParameterObject]));
    expect(cursorBoundaryFuzzing.applies(g)).toBe(true);
  });
});

describe("cursor_boundary_fuzzing — verdicts", () => {
  test("any 5xx mutation → fail HIGH", async () => {
    // 7 mutations × 1 cursor param = 7 sends. Mix: 1 × 500, rest 400.
    const responses: HttpResponse[] = [
      rs(500, '{"error":"boom"}'),
      ...Array.from({ length: 6 }, () => rs(400)),
    ];
    const g = makeGroup(makeList([cursorParam("starting_after")]));
    const h = stubHarness(responses);
    const out = await cursorBoundaryFuzzing.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.severity).toBe("high");
      expect(out.evidence?.kind).toBe("server_error_on_bad_cursor");
      const errs = (out.evidence?.server_errors as Array<{ status: number }>);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.status).toBe(500);
    }
    expect(h.calls).toHaveLength(7);
  });

  test("all 4xx → pass", async () => {
    const responses = Array.from({ length: 7 }, () => rs(400));
    const g = makeGroup(makeList([cursorParam("cursor")]));
    const h = stubHarness(responses);
    const out = await cursorBoundaryFuzzing.run(g, h);
    expect(out.kind).toBe("pass");
  });

  test("2xx on malformed cursor → fail LOW (silent accept)", async () => {
    // Server tolerates every malformed cursor: that's a finding but not 5xx.
    const responses = Array.from({ length: 7 }, () => rs(200, "[]"));
    const g = makeGroup(makeList([cursorParam("page_token")]));
    const h = stubHarness(responses);
    const out = await cursorBoundaryFuzzing.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.severity).toBe("low");
      expect(out.evidence?.kind).toBe("silent_accept_on_bad_cursor");
    }
  });

  test("only 401/403 → skip (auth-gated)", async () => {
    const responses = Array.from({ length: 7 }, (_, i) => rs(i % 2 === 0 ? 401 : 403));
    const g = makeGroup(makeList([cursorParam("after")]));
    const h = stubHarness(responses);
    const out = await cursorBoundaryFuzzing.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/auth-gated/);
  });

  test("two cursor params → 7×2 = 14 mutations", async () => {
    const responses = Array.from({ length: 14 }, () => rs(400));
    const g = makeGroup(
      makeList([cursorParam("starting_after"), cursorParam("ending_before")]),
    );
    const h = stubHarness(responses);
    const out = await cursorBoundaryFuzzing.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls).toHaveLength(14);
    expect(new Set(h.calls.map((c) => c.url)).size).toBe(14);
  });

  test("bootstrap-cleanup failed → skip", async () => {
    const g = makeGroup(makeList([cursorParam("cursor")]));
    const h = stubHarness([]);
    h.bootstrapCleanupFailed = true;
    const out = await cursorBoundaryFuzzing.run(g, h);
    expect(out.kind).toBe("skip");
  });
});
