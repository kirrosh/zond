/**
 * Unit tests for `idempotency_replay` (m-20 ARV-170).
 *
 * Stubbed harness drives [POST1, POST2, DELETE...] tuples so each
 * verdict is exercised deterministically.
 *
 *   1. opt-out: no yaml config + no Idempotency-Key parameter → skip
 *      (probe declines silently — it can't tell if the API supports
 *      idempotency).
 *   2. honored: yaml cfg + replay returns same id and bit-identical
 *      body → pass.
 *   3. duplicate: replay returns a *different* id → fail with
 *      evidence.kind = "duplicate_resource".
 *   4. non-bit-identical: same id but bodies differ on a non-ignored
 *      field → fail with evidence.kind = "non_bit_identical".
 *   5. spec-detected: no yaml but `Idempotency-Key` declared as
 *      parameter on create → check runs.
 *   6. broken baseline: 5xx on either POST → skip.
 *   7. rate-limit on 2nd POST → skip with cleanup of 1st.
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import { idempotencyReplay } from "../../../src/core/checks/checks/idempotency_replay.ts";
import type { StatefulHarness } from "../../../src/core/checks/stateful.ts";
import type { CrudGroup, EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpResponse, HttpRequest } from "../../../src/core/runner/types.ts";
import type { IdempotencyConfig } from "../../../src/core/generator/resources-builder.ts";

function makeCreate(over: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    path: "/charges",
    method: "POST",
    operationId: "create_charge",
    tags: [],
    parameters: [],
    requestBodySchema: {
      type: "object",
      properties: { amount: { type: "integer" } },
      required: ["amount"],
    } as OpenAPIV3.SchemaObject,
    requestBodyContentType: "application/json",
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    ...over,
  };
}

function makeDelete(): EndpointInfo {
  return {
    path: "/charges/{charge_id}",
    method: "DELETE",
    operationId: "delete_charge",
    tags: [],
    parameters: [],
    responseContentTypes: [],
    responses: [{ statusCode: 204, description: "ok" }],
    security: [],
  };
}

function makeGroup(create: EndpointInfo, del?: EndpointInfo): CrudGroup {
  return {
    resource: "charge",
    basePath: "/charges",
    itemPath: "/charges/{charge_id}",
    idParam: "charge_id",
    create,
    delete: del,
  };
}

function r2xx(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body), body_parsed: body, duration_ms: 1 };
}

function rStatus(status: number): HttpResponse {
  return { status, headers: {}, body: "", duration_ms: 1 };
}

interface SentCall { req: HttpRequest }

function stubHarness(
  responses: HttpResponse[],
  configs?: Map<string, { idempotency?: IdempotencyConfig }>,
): StatefulHarness & { calls: SentCall[] } {
  let i = 0;
  const calls: SentCall[] = [];
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
      if (!r) throw new Error(`unexpected send call #${i}`);
      return r;
    },
  };
}

describe("idempotency_replay — stateful check", () => {
  test("opts out when no yaml and no spec header", async () => {
    const g = makeGroup(makeCreate(), makeDelete());
    const h = stubHarness([]);
    const out = await idempotencyReplay.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/no idempotency config/);
    expect(h.calls.length).toBe(0);
  });

  test("passes when replay returns same id and bit-identical body", async () => {
    const cfg = new Map([["charge", { idempotency: { header: "Idempotency-Key" } as IdempotencyConfig }]]);
    const g = makeGroup(makeCreate(), makeDelete());
    const h = stubHarness([
      r2xx({ id: "ch_1", amount: 100, created: 1, request_id: "req_A" }),
      r2xx({ id: "ch_1", amount: 100, created: 2, request_id: "req_B" }), // ignored fields differ
      rStatus(204), // cleanup
    ], cfg);
    const out = await idempotencyReplay.run(g, h);
    expect(out.kind).toBe("pass");
    // Both POSTs should share the same Idempotency-Key header.
    const k1 = h.calls[0]!.req.headers!["Idempotency-Key"];
    const k2 = h.calls[1]!.req.headers!["Idempotency-Key"];
    expect(k1).toBeTruthy();
    expect(k1).toBe(k2);
  });

  test("fails HIGH when replay creates duplicate resource", async () => {
    const cfg = new Map([["charge", { idempotency: {} as IdempotencyConfig }]]);
    const g = makeGroup(makeCreate(), makeDelete());
    const h = stubHarness([
      r2xx({ id: "ch_1", amount: 100 }),
      r2xx({ id: "ch_2", amount: 100 }), // different id ⇒ duplicate
      rStatus(204), // cleanup id1
      rStatus(204), // cleanup id2
    ], cfg);
    const out = await idempotencyReplay.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toBe("duplicate_resource");
      expect(out.evidence?.id1).toBe("ch_1");
      expect(out.evidence?.id2).toBe("ch_2");
    }
  });

  test("fails when same id but bodies differ on a non-ignored field", async () => {
    const cfg = new Map([["charge", { idempotency: {} as IdempotencyConfig }]]);
    const g = makeGroup(makeCreate(), makeDelete());
    const h = stubHarness([
      r2xx({ id: "ch_1", amount: 100, status: "paid" }),
      r2xx({ id: "ch_1", amount: 100, status: "pending" }),
      rStatus(204),
    ], cfg);
    const out = await idempotencyReplay.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toBe("non_bit_identical");
      expect(out.evidence?.diff_fields).toEqual(["status"]);
    }
  });

  test("auto-detects Idempotency-Key parameter from spec", async () => {
    const create = makeCreate({
      parameters: [
        { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" } } as OpenAPIV3.ParameterObject,
      ],
    });
    const g = makeGroup(create, makeDelete());
    const h = stubHarness([
      r2xx({ id: "ch_1", amount: 100 }),
      r2xx({ id: "ch_1", amount: 100 }),
      rStatus(204),
    ]);
    const out = await idempotencyReplay.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls[0]!.req.headers!["Idempotency-Key"]).toBeTruthy();
  });

  test("skips on 5xx broken baseline", async () => {
    const cfg = new Map([["charge", { idempotency: {} as IdempotencyConfig }]]);
    const g = makeGroup(makeCreate(), makeDelete());
    const h = stubHarness([
      rStatus(500),
    ], cfg);
    const out = await idempotencyReplay.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/1st create returned 500/);
  });

  test("skips on 429 rate-limit at 2nd POST and cleans up 1st", async () => {
    const cfg = new Map([["charge", { idempotency: {} as IdempotencyConfig }]]);
    const g = makeGroup(makeCreate(), makeDelete());
    const h = stubHarness([
      r2xx({ id: "ch_1", amount: 100 }),
      rStatus(429),
      rStatus(204), // cleanup
    ], cfg);
    const out = await idempotencyReplay.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/429/);
    // 3rd send must be DELETE for cleanup
    expect(h.calls[2]!.req.method).toBe("DELETE");
  });

  test("honors yaml-declared custom ignoreResponseFields", async () => {
    const cfg = new Map([[
      "charge",
      { idempotency: { ignoreResponseFields: ["nonce"] } as IdempotencyConfig },
    ]]);
    const g = makeGroup(makeCreate(), makeDelete());
    const h = stubHarness([
      r2xx({ id: "ch_1", amount: 100, nonce: "A" }),
      r2xx({ id: "ch_1", amount: 100, nonce: "B" }),
      rStatus(204),
    ], cfg);
    const out = await idempotencyReplay.run(g, h);
    expect(out.kind).toBe("pass");
  });
});
