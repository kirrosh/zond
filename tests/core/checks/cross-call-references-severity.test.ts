/**
 * ARV-287: per-finding severity matrix for cross_call_references.
 *
 * Locks the proof-cap baseline and per-evidence dispatch:
 *   - declared check severity is 'low' (proof-cap per ARV-250)
 *   - state_not_persisted non-empty (POST echoed → GET dropped) → HIGH
 *   - write-only-only (POST accepted → GET never returned) → MEDIUM
 *   - both drift kinds present → HIGH (state_not_persisted wins)
 *   - no drift → pass (no severity)
 *
 * Follow-up to ARV-284 (negative_data_rejection severity matrix).
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import { crossCallReferences } from "../../../src/core/checks/checks/cross_call_references.ts";
import type { StatefulHarness } from "../../../src/core/checks/stateful.ts";
import type { CrudGroup, EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpResponse } from "../../../src/core/runner/types.ts";
import type { ReadbackDiffConfig } from "../../../src/core/generator/resources-builder.ts";

function makeEp(over: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    path: "/items",
    method: "POST",
    operationId: "create_item",
    tags: [],
    parameters: [],
    requestBodySchema: {
      type: "object",
      properties: { foo: { type: "string" }, bar: { type: "string" } },
      required: ["foo"],
    } as OpenAPIV3.SchemaObject,
    requestBodyContentType: "application/json",
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    ...over,
  };
}

function makeReadEp(
  props: Record<string, OpenAPIV3.SchemaObject> = {
    foo: { type: "string" },
    bar: { type: "string" },
  },
): EndpointInfo {
  return makeEp({
    path: "/items/{item_id}",
    method: "GET",
    operationId: "read_item",
    requestBodySchema: undefined,
    responses: [
      {
        statusCode: 200,
        description: "ok",
        schema: { type: "object", properties: props } as OpenAPIV3.SchemaObject,
      },
    ],
  });
}

function makeGroup(create: EndpointInfo, read: EndpointInfo): CrudGroup {
  return {
    resource: "item",
    basePath: "/items",
    itemPath: "/items/{item_id}",
    idParam: "item_id",
    create,
    read,
  };
}

function stubHarness(
  responses: HttpResponse[],
  configs?: Map<string, { readbackDiff?: ReadbackDiffConfig }>,
): StatefulHarness {
  let call = 0;
  return {
    baseUrl: "http://test",
    doc: { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} } as OpenAPIV3.Document,
    authHeaders: {},
    bootstrapCleanupFailed: false,
    resourceConfigs: configs,
    async send(): Promise<HttpResponse> {
      const r = responses[call++];
      if (!r) throw new Error(`unexpected send call #${call}`);
      return r;
    },
  };
}

function r2xx(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body), body_parsed: body, duration_ms: 1 };
}

describe("crossCallReferences — severity matrix (ARV-287)", () => {
  test("declared check severity is 'low' (proof-cap baseline)", () => {
    expect(crossCallReferences.severity).toBe("low");
  });

  test("state_not_persisted non-empty → fail HIGH (POST echoed 'foo', GET dropped it)", async () => {
    // POST echoes 'foo' (non-null), GET response omits it → state_not_persisted
    const g = makeGroup(makeEp(), makeReadEp());
    const h = stubHarness([
      r2xx({ id: "item_1", foo: "hello" }), // create echo: foo is present
      r2xx({ id: "item_1" }),               // GET: foo dropped
    ]);
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind !== "fail") return;
    expect(out.severity).toBe("high");
    const snp = out.evidence!.state_not_persisted as Array<{ field: string }>;
    expect(snp.map((x) => x.field)).toContain("foo");
  });

  test("write-only-only (state_not_persisted=[], writeOnly=['bar']) → fail MEDIUM", async () => {
    // POST does NOT echo 'bar' (not in create response), GET also drops it
    // → write_only (single-signal contract gap)
    const g = makeGroup(makeEp(), makeReadEp());
    const h = stubHarness([
      r2xx({ id: "item_1", foo: "hello" }), // create echo: no 'bar' → write_only
      r2xx({ id: "item_1", foo: "hello" }), // GET: no 'bar' either
    ]);
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind !== "fail") return;
    expect(out.severity).toBe("medium");
    const wo = out.evidence!.write_only as string[];
    expect(wo).toContain("bar");
    expect((out.evidence!.state_not_persisted as unknown[]).length).toBe(0);
  });

  test("both 'foo' state_not_persisted and 'bar' write_only → fail HIGH (state_not_persisted wins)", async () => {
    // POST echoes 'foo' (non-null), GET drops both 'foo' and 'bar'
    const g = makeGroup(makeEp(), makeReadEp());
    const h = stubHarness([
      r2xx({ id: "item_1", foo: "hello" }), // create echo: foo present, bar absent
      r2xx({ id: "item_1" }),               // GET: neither foo nor bar
    ]);
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind !== "fail") return;
    expect(out.severity).toBe("high");
    const snp = out.evidence!.state_not_persisted as Array<{ field: string }>;
    const wo = out.evidence!.write_only as string[];
    expect(snp.map((x) => x.field)).toContain("foo");
    expect(wo).toContain("bar");
  });

  test("no drift → pass (no severity emitted)", async () => {
    const g = makeGroup(makeEp(), makeReadEp());
    const h = stubHarness([
      r2xx({ id: "item_1", foo: "hello", bar: "world" }),
      r2xx({ id: "item_1", foo: "hello", bar: "world" }),
    ]);
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("pass");
  });
});
