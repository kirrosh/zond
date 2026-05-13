/**
 * Unit tests for `cross_call_references` (m-20 ARV-169).
 *
 * Drives the stateful check directly against a stubbed harness so each
 * case exercises a [write-body, echo, readback] tuple deterministically.
 * Covers:
 *   1. Anti-FP defaults — timestamp/etag/envelope fields ignored.
 *   2. write_only — POST accepted, GET dropped → finding (MEDIUM-class
 *      surfaced in evidence; severity HIGH at the check level).
 *   3. state_not_persisted — POST echoed back, GET dropped → finding.
 *   4. ignore_fields override drops API-quirks (Stripe metadata).
 *   5. write_to_read_map renames write-side field to read-side name.
 *   6. Broken baseline (5xx on create / read) → skip, no finding.
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import { crossCallReferences } from "../../../src/core/checks/checks/cross_call_references.ts";
import type { StatefulHarness } from "../../../src/core/checks/stateful.ts";
import type { CrudGroup, EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpResponse } from "../../../src/core/runner/types.ts";
import type { ReadbackDiffConfig } from "../../../src/core/generator/resources-builder.ts";
import { computeDrift, DEFAULT_READBACK_IGNORE } from "../../../src/core/checks/checks/_readback-helpers.ts";

function makeEp(over: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    path: "/customers",
    method: "POST",
    operationId: "create_customer",
    tags: [],
    parameters: [],
    // Single-property schema keeps the data-factory output deterministic
    // so harness fixtures can match it exactly without re-running the
    // generator. Each test that needs broader echo/read shapes adds the
    // extra fields via the harness response, not the write body.
    requestBodySchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    } as OpenAPIV3.SchemaObject,
    requestBodyContentType: "application/json",
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
    ...over,
  };
}

function makeReadEp(props: Record<string, OpenAPIV3.SchemaObject> = { name: { type: "string" }, email: { type: "string" }, metadata: { type: "object" } }): EndpointInfo {
  return makeEp({
    path: "/customers/{customer_id}",
    method: "GET",
    operationId: "read_customer",
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
    resource: "customer",
    basePath: "/customers",
    itemPath: "/customers/{customer_id}",
    idParam: "customer_id",
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

describe("computeDrift (pure)", () => {
  test("defaults ignore timestamp/etag/envelope fields", () => {
    const write = { name: "Alice" };
    const echo = { id: "1", name: "Alice", created_at: "2026-01-01", etag: "x" };
    const read = { id: "1", name: "Alice" };
    const d = computeDrift(write, echo, read, new Set(["name"]), undefined);
    expect(d.stateNotPersisted).toEqual([]);
    expect(d.writeOnly).toEqual([]);
  });

  test("detects state_not_persisted when echo carries non-null field GET drops", () => {
    const write = { name: "Alice" };
    const echo = { id: "1", name: "Alice", tax_id: "EU1" };
    const read = { id: "1", name: "Alice" };
    const d = computeDrift(write, echo, read, new Set(["name", "tax_id"]), undefined);
    expect(d.stateNotPersisted.map((x) => x.field)).toEqual(["tax_id"]);
  });

  test("detects write_only when POST accepted spec-declared field but GET drops it", () => {
    const write = { name: "Alice", email: "a@b.c" };
    const echo = { id: "1", name: "Alice" };
    const read = { id: "1", name: "Alice" };
    const d = computeDrift(write, echo, read, new Set(["name", "email"]), undefined);
    expect(d.writeOnly.map((x) => x.field)).toEqual(["email"]);
  });

  test("does not flag write_only when field is undeclared on GET (write-only-by-spec)", () => {
    const write = { name: "Alice", password: "s3cret" };
    const echo = { id: "1", name: "Alice" };
    const read = { id: "1", name: "Alice" };
    // password not in declared GET fields ⇒ write-only-by-design, no finding
    const d = computeDrift(write, echo, read, new Set(["name"]), undefined);
    expect(d.writeOnly).toEqual([]);
  });

  test("ignore_fields suppresses API quirks (Stripe metadata)", () => {
    const write = { name: "Alice", metadata: { tier: "gold" } };
    const echo = { id: "1", name: "Alice", metadata: { tier: "gold" } };
    const read = { id: "1", name: "Alice" }; // Stripe strips metadata
    const cfg: ReadbackDiffConfig = { ignoreFields: ["metadata"] };
    const d = computeDrift(write, echo, read, new Set(["name", "metadata"]), cfg);
    expect(d.stateNotPersisted).toEqual([]);
    expect(d.writeOnly).toEqual([]);
  });

  test("write_to_read_map renames write-side field to read-side", () => {
    const write = { name: "Alice", tax_id_data: "EU1" };
    const echo = { id: "1", name: "Alice", tax_id_data: "EU1" };
    const read = { id: "1", name: "Alice", tax_ids: "EU1" };
    const cfg: ReadbackDiffConfig = { writeToReadMap: { tax_id_data: "tax_ids" } };
    // After rename `tax_id_data → tax_ids`, the GET has it ⇒ no drift.
    const d = computeDrift(write, echo, read, new Set(["name", "tax_ids"]), cfg);
    expect(d.stateNotPersisted).toEqual([]);
    expect(d.writeOnly).toEqual([]);
  });

  test("DEFAULT_READBACK_IGNORE covers common timestamp/etag fields", () => {
    expect(DEFAULT_READBACK_IGNORE.has("created")).toBe(true);
    expect(DEFAULT_READBACK_IGNORE.has("updated_at")).toBe(true);
    expect(DEFAULT_READBACK_IGNORE.has("etag")).toBe(true);
    expect(DEFAULT_READBACK_IGNORE.has("livemode")).toBe(true);
  });
});

describe("crossCallReferences — stateful check", () => {
  test("passes when write/echo/read shapes align (modulo defaults)", async () => {
    const g = makeGroup(makeEp(), makeReadEp());
    const h = stubHarness([
      r2xx({ id: "c_1", name: "Test", email: "x@y.z", created_at: "2026" }),
      r2xx({ id: "c_1", name: "Test", email: "x@y.z", created_at: "2026" }),
    ]);
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("pass");
  });

  test("fails with state_not_persisted when echo has field GET drops", async () => {
    const g = makeGroup(makeEp(), makeReadEp());
    const h = stubHarness([
      r2xx({ id: "c_1", name: "Test", email: "x@y.z" }),
      r2xx({ id: "c_1", name: "Test" }),
    ]);
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.state_not_persisted).toBeDefined();
      const snp = out.evidence!.state_not_persisted as Array<{ field: string }>;
      expect(snp.map((x) => x.field)).toContain("email");
    }
  });

  test("suppresses Stripe-metadata quirk when ignore_fields configured", async () => {
    const g = makeGroup(makeEp(), makeReadEp());
    const configs = new Map([["customer", { readbackDiff: { ignoreFields: ["metadata"] } }]]);
    const h = stubHarness(
      [
        r2xx({ id: "c_1", name: "Test", metadata: { tier: "gold" } }),
        r2xx({ id: "c_1", name: "Test" }), // metadata stripped
      ],
      configs,
    );
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("pass");
  });

  test("skips on 5xx create (broken-baseline guard)", async () => {
    const g = makeGroup(makeEp(), makeReadEp());
    const h = stubHarness([{ status: 503, headers: {}, body: "", duration_ms: 1 }]);
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("skip");
  });

  test("skips when bootstrap-cleanup failed", async () => {
    const g = makeGroup(makeEp(), makeReadEp());
    const h: StatefulHarness = {
      ...stubHarness([]),
      bootstrapCleanupFailed: true,
    };
    const out = await crossCallReferences.run(g, h);
    expect(out.kind).toBe("skip");
  });

  test("applies() requires both create and read", () => {
    const g1: CrudGroup = { resource: "x", basePath: "/x", itemPath: "/x/{id}", idParam: "id", create: makeEp() };
    expect(crossCallReferences.applies(g1)).toBe(false);
    const g2 = makeGroup(makeEp(), makeReadEp());
    expect(crossCallReferences.applies(g2)).toBe(true);
  });
});
