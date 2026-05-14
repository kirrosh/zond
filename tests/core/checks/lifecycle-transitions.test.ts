/**
 * Unit tests for `lifecycle_transitions` (m-20 ARV-172).
 *
 * Two suites:
 *   1. validateLifecycleManifest — catches authoring bugs at load.
 *   2. lifecycleTransitions check — stub-harness drives the
 *      [POST create, POST action, GET read, POST replay, GET read]
 *      sequences and asserts each verdict.
 */
import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";

import { lifecycleTransitions } from "../../../src/core/checks/checks/lifecycle_transitions.ts";
import { validateLifecycleManifest } from "../../../src/core/generator/resources-builder.ts";
import type { LifecycleConfig } from "../../../src/core/generator/resources-builder.ts";
import type { StatefulHarness } from "../../../src/core/checks/stateful.ts";
import type { CrudGroup, EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpResponse, HttpRequest } from "../../../src/core/runner/types.ts";

function makeCreate(): EndpointInfo {
  return {
    path: "/subs",
    method: "POST",
    operationId: "create_sub",
    tags: [],
    parameters: [],
    requestBodySchema: { type: "object", properties: { plan: { type: "string" } } } as OpenAPIV3.SchemaObject,
    requestBodyContentType: "application/json",
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
  };
}

function makeRead(): EndpointInfo {
  return {
    path: "/subs/{sub_id}",
    method: "GET",
    operationId: "read_sub",
    tags: [],
    parameters: [],
    responseContentTypes: ["application/json"],
    responses: [{ statusCode: 200, description: "ok" }],
    security: [],
  };
}

function makeGroup(): CrudGroup {
  return {
    resource: "subscription",
    basePath: "/subs",
    itemPath: "/subs/{sub_id}",
    idParam: "sub_id",
    create: makeCreate(),
    read: makeRead(),
  };
}

const SUBSCRIPTION_LIFECYCLE: LifecycleConfig = {
  field: "status",
  states: ["pending", "active", "cancelled"],
  transitions: [
    { from: "pending", to: ["active", "cancelled"] },
    { from: "active", to: ["cancelled"] },
    { from: "cancelled", to: [] },
  ],
  actions: {
    cancel: { endpoint: "POST /subs/{sub_id}/cancel", expectedState: "cancelled" },
  },
};

function r2xx(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body), body_parsed: body, duration_ms: 1 };
}
function rStatus(status: number): HttpResponse {
  return { status, headers: {}, body: "", duration_ms: 1 };
}

interface Call { req: HttpRequest }
function stubHarness(
  responses: HttpResponse[],
  configs?: Map<string, { lifecycle?: LifecycleConfig }>,
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

describe("validateLifecycleManifest", () => {
  test("clean manifest passes", () => {
    expect(validateLifecycleManifest(SUBSCRIPTION_LIFECYCLE)).toEqual([]);
  });

  test("missing field reported", () => {
    const errs = validateLifecycleManifest({ ...SUBSCRIPTION_LIFECYCLE, field: "" });
    expect(errs).toContain("lifecycle.field is empty");
  });

  test("unknown 'from' state in transition", () => {
    const errs = validateLifecycleManifest({
      ...SUBSCRIPTION_LIFECYCLE,
      transitions: [{ from: "ghost", to: ["active"] }, ...SUBSCRIPTION_LIFECYCLE.transitions],
    });
    expect(errs.some((e) => e.includes('unknown "from" state "ghost"'))).toBe(true);
  });

  test("unknown 'to' state in transition", () => {
    const errs = validateLifecycleManifest({
      ...SUBSCRIPTION_LIFECYCLE,
      transitions: [{ from: "pending", to: ["zombie"] }],
    });
    expect(errs.some((e) => e.includes("unknown") && e.includes("zombie"))).toBe(true);
  });

  test("no terminal state — every state has outgoing transition", () => {
    const errs = validateLifecycleManifest({
      ...SUBSCRIPTION_LIFECYCLE,
      transitions: [
        { from: "pending", to: ["active"] },
        { from: "active", to: ["cancelled"] },
        { from: "cancelled", to: ["pending"] },
      ],
    });
    expect(errs.some((e) => e.includes("no terminal"))).toBe(true);
  });

  test("action.expected_state must be in states[]", () => {
    const errs = validateLifecycleManifest({
      ...SUBSCRIPTION_LIFECYCLE,
      actions: { cancel: { endpoint: "POST /x", expectedState: "deleted" } },
    });
    expect(errs.some((e) => e.includes('expected_state "deleted"'))).toBe(true);
  });
});

describe("lifecycle_transitions — stateful check", () => {
  test("skips when no lifecycle config", async () => {
    const out = await lifecycleTransitions.run(makeGroup(), stubHarness([]));
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/no lifecycle config/);
  });

  test("skips when manifest invalid", async () => {
    const cfg = new Map([["subscription", { lifecycle: { ...SUBSCRIPTION_LIFECYCLE, field: "" } }]]);
    const out = await lifecycleTransitions.run(makeGroup(), stubHarness([], cfg));
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/manifest invalid/);
  });

  test("happy path: create → cancel → cancelled → replay → still cancelled", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "active" }),       // create
      r2xx({ status: "cancelled" }),                   // POST cancel (action)
      r2xx({ id: "sub_1", status: "cancelled" }),     // GET read
      r2xx({ status: "cancelled" }),                   // POST cancel (replay)
      r2xx({ id: "sub_1", status: "cancelled" }),     // GET read after replay
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("pass");
  });

  test("fails on undeclared state from create", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "ghost" }), // undeclared
      r2xx({ status: "cancelled" }),
      r2xx({ id: "sub_1", status: "cancelled" }),
      r2xx({ status: "cancelled" }),
      r2xx({ id: "sub_1", status: "cancelled" }),
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.evidence?.kind).toContain("undeclared_state");
  });

  test("fails on wrong expected_state after action", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "active" }),
      r2xx({ status: "active" }),                  // action accepted
      r2xx({ id: "sub_1", status: "active" }),    // but state never moved
      r2xx({ status: "active" }),
      r2xx({ id: "sub_1", status: "active" }),
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.evidence?.kind).toContain("wrong_expected_state");
  });

  test("fails on forbidden transition (cancelled → active)", async () => {
    const cfg = new Map([["subscription", {
      lifecycle: {
        ...SUBSCRIPTION_LIFECYCLE,
        actions: { reactivate: { endpoint: "POST /subs/{sub_id}/reactivate", expectedState: "active" } },
      },
    }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "cancelled" }),  // start cancelled (already terminal)
      r2xx({ status: "active" }),                  // action accepted
      r2xx({ id: "sub_1", status: "active" }),    // observed → active (cancelled→active forbidden)
      r2xx({ status: "active" }),
      r2xx({ id: "sub_1", status: "active" }),
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.evidence?.kind).toContain("forbidden_transition");
  });

  test("fails on state regression after replay", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "active" }),
      r2xx({ status: "cancelled" }),
      r2xx({ id: "sub_1", status: "cancelled" }),
      r2xx({ status: "active" }),                 // replay accepted
      r2xx({ id: "sub_1", status: "active" }),   // and state regressed to active
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.evidence?.kind).toContain("state_regression_on_replay");
  });

  test("fails on 5xx after double cancel (replay must not crash)", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "active" }),
      r2xx({ status: "cancelled" }),
      r2xx({ id: "sub_1", status: "cancelled" }),
      rStatus(500),                                 // replay 5xx
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.evidence?.kind).toContain("double_action_5xx");
  });

  test("skips when action returns 4xx on first call (server-side gating)", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "active" }),
      rStatus(403),   // action denied
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") expect(out.evidence?.kind).toContain("action_rejected");
  });

  test("skips when create broken-baseline", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const h = stubHarness([rStatus(500)], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/create returned 500/);
  });

  test("URL substitution: action endpoint {id} replaced with captured id", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const h = stubHarness([
      r2xx({ id: "sub_xyz", status: "active" }),
      r2xx({ status: "cancelled" }),
      r2xx({ id: "sub_xyz", status: "cancelled" }),
      r2xx({ status: "cancelled" }),
      r2xx({ id: "sub_xyz", status: "cancelled" }),
    ], cfg);
    await lifecycleTransitions.run(makeGroup(), h);
    // 2nd call (action POST) should hit /subs/sub_xyz/cancel
    expect(h.calls[1]!.req.url).toContain("/subs/sub_xyz/cancel");
  });
});
