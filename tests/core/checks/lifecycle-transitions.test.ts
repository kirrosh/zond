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

  test("ARV-433: flags finalize→paid drift when overlay declares finalize→open (Stripe deep-dive repro)", async () => {
    // Invoice-style state machine: draft --finalize--> open --pay--> paid.
    // The bug (masked by the ARV-430 currency default) landed a $0 invoice
    // straight in `paid` on finalize. The check must flag BOTH the graph
    // violation (draft→paid ∉ transitions) and the per-action expectation
    // miss (finalize expected `open`, observed `paid`).
    const INVOICE_LIFECYCLE: LifecycleConfig = {
      field: "status",
      states: ["draft", "open", "paid", "void"],
      transitions: [
        { from: "draft", to: ["open"] },
        { from: "open", to: ["paid", "void"] },
        { from: "paid", to: [] },
        { from: "void", to: [] },
      ],
      actions: {
        finalize: { endpoint: "POST /subs/{sub_id}/finalize", expectedState: "open" },
      },
    };
    const cfg = new Map([["subscription", { lifecycle: INVOICE_LIFECYCLE }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "draft" }),   // create → draft
      r2xx({ status: "paid" }),                  // finalize accepted
      r2xx({ id: "sub_1", status: "paid" }),    // observed → paid (draft→paid forbidden, expected open)
      r2xx({ status: "paid" }),                  // replay accepted
      r2xx({ id: "sub_1", status: "paid" }),    // stays paid
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toContain("forbidden_transition");
      expect(out.evidence?.kind).toContain("wrong_expected_state");
    }
  });

  test("ARV-433: empty transitions graph does not false-flag legitimate actions as forbidden", async () => {
    // Overlay declares states + actions but no transition graph. A correct
    // cancel (active→cancelled) must NOT raise forbidden_transition — the
    // graph is silent, so there is nothing to violate. wrong_expected_state
    // still guards per-action drift.
    const cfg = new Map([["subscription", {
      lifecycle: { ...SUBSCRIPTION_LIFECYCLE, transitions: [] },
    }]]);
    const h = stubHarness([
      r2xx({ id: "sub_1", status: "active" }),
      r2xx({ status: "cancelled" }),               // cancel accepted
      r2xx({ id: "sub_1", status: "cancelled" }),  // observed cancelled (== expected)
      r2xx({ status: "cancelled" }),
      r2xx({ id: "sub_1", status: "cancelled" }),
    ], cfg);
    const out = await lifecycleTransitions.run(makeGroup(), h);
    expect(out.kind).toBe("pass");
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

  // ── ARV-219: pure-observation mode (no `actions` block) ────────

  function makeList(over: Partial<EndpointInfo> = {}): EndpointInfo {
    return {
      path: "/subs",
      method: "GET",
      operationId: "list_subs",
      tags: [],
      parameters: [],
      responseContentTypes: ["application/json"],
      responses: [{ statusCode: 200, description: "ok" }],
      security: [],
      ...over,
    };
  }
  const LIFECYCLE_NO_ACTIONS: LifecycleConfig = {
    field: "status",
    states: ["pending", "active", "cancelled"],
    transitions: [
      { from: "pending", to: ["active", "cancelled"] },
      { from: "active", to: ["cancelled"] },
      { from: "cancelled", to: [] },
    ],
    actions: {},
  };

  test("observation: all observed states declared → pass", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const g: CrudGroup = { ...makeGroup(), list: makeList() };
    const h = stubHarness([
      r2xx([
        { id: "sub_1", status: "active" },
        { id: "sub_2", status: "pending" },
        { id: "sub_3", status: "cancelled" },
      ]),
    ], cfg);
    const out = await lifecycleTransitions.run(g, h);
    expect(out.kind).toBe("pass");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.req.method).toBe("GET");
    expect(h.calls[0]!.req.url).toContain("/subs");
  });

  test("observation: undeclared state in list → fail undeclared_state", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const g: CrudGroup = { ...makeGroup(), list: makeList() };
    const h = stubHarness([
      r2xx({ data: [
        { id: "sub_1", status: "active" },
        { id: "sub_2", status: "ghost" },     // undeclared
        { id: "sub_3", status: "zombie" },    // undeclared, different value
        { id: "sub_4", status: "ghost" },     // same undeclared state, second sample id
      ] }),
    ], cfg);
    const out = await lifecycleTransitions.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      expect(out.evidence?.kind).toBe("undeclared_state");
      expect(out.evidence?.mode).toBe("observation");
      const observed = out.evidence?.observed_undeclared as Array<{ state: string; sample_ids: string[] }>;
      expect(observed.map((o) => o.state).sort()).toEqual(["ghost", "zombie"]);
      const ghost = observed.find((o) => o.state === "ghost")!;
      expect(ghost.sample_ids).toEqual(["sub_2", "sub_4"]);
      expect(out.evidence?.items_examined).toBe(4);
    }
  });

  test("observation: empty list → skip", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const g: CrudGroup = { ...makeGroup(), list: makeList() };
    const h = stubHarness([r2xx([])], cfg);
    const out = await lifecycleTransitions.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/empty/);
  });

  test("observation: list 5xx → skip broken-baseline", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const g: CrudGroup = { ...makeGroup(), list: makeList() };
    const h = stubHarness([rStatus(503)], cfg);
    const out = await lifecycleTransitions.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/observation mode/);
  });

  test("observation: state field missing on EVERY item → skip with yaml-mismatch hint", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const g: CrudGroup = { ...makeGroup(), list: makeList() };
    const h = stubHarness([r2xx([
      { id: "sub_1", state: "active" },   // wrong field name
      { id: "sub_2", state: "pending" },
    ])], cfg);
    const out = await lifecycleTransitions.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/state field "status" missing/);
  });

  test("observation: GitHub-shape body picks the longest array (e.g. {workflow_runs:[...], total_count:42})", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const g: CrudGroup = { ...makeGroup(), list: makeList() };
    const h = stubHarness([
      r2xx({
        total_count: 3,
        workflow_runs: [
          { id: 1, status: "active" },
          { id: 2, status: "pending" },
        ],
      }),
    ], cfg);
    const out = await lifecycleTransitions.run(g, h);
    expect(out.kind).toBe("pass");
  });

  test("observation: unrecognised list body shape → skip", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const g: CrudGroup = { ...makeGroup(), list: makeList() };
    const h = stubHarness([r2xx({ unexpected_root: "no array here" })], cfg);
    const out = await lifecycleTransitions.run(g, h);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/shape not recognised/);
  });

  test("observation: no list endpoint + no actions → skip with explicit reason", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const out = await lifecycleTransitions.run(makeGroup(), stubHarness([], cfg));
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/no actions and no list endpoint/);
  });

  test("observation: sample id falls back to `number` when idParam-field missing (GitHub Issues shape)", async () => {
    const cfg = new Map([["subscription", { lifecycle: LIFECYCLE_NO_ACTIONS }]]);
    const g: CrudGroup = { ...makeGroup(), list: makeList() };
    const h = stubHarness([
      r2xx([
        { number: 42, status: "ghost" },    // no `sub_id` or `id`
      ]),
    ], cfg);
    const out = await lifecycleTransitions.run(g, h);
    expect(out.kind).toBe("fail");
    if (out.kind === "fail") {
      const observed = out.evidence?.observed_undeclared as Array<{ state: string; sample_ids: string[] }>;
      expect(observed[0]!.sample_ids).toEqual(["42"]);
    }
  });

  test("action-mode declared but resource lacks create+read → explicit skip", async () => {
    const cfg = new Map([["subscription", { lifecycle: SUBSCRIPTION_LIFECYCLE }]]);
    const g: CrudGroup = {
      resource: "subscription",
      basePath: "/subs",
      itemPath: "/subs/{sub_id}",
      idParam: "sub_id",
      list: makeList(),
    };
    const out = await lifecycleTransitions.run(g, stubHarness([], cfg));
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") expect(out.reason).toMatch(/lacks create\+read/);
  });
});
