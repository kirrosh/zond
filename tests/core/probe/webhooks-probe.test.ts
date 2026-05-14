/**
 * Unit tests for the webhooks probe core (m-20 ARV-173).
 *
 * Live HTTP receiver lives in the recipe; here we drive the offline
 * shape-conformance loop with synthetic events + spec snippets.
 */
import { describe, test, expect } from "bun:test";
import {
  parseEventLog,
  runWebhooksProbe,
  readWebhooksMap,
  type WebhookFinding,
} from "../../../src/core/probe/webhooks-probe.ts";

function makeSpec(webhooks: Record<string, unknown>, version: "3.1" | "3.0" = "3.1"): unknown {
  return {
    openapi: version === "3.1" ? "3.1.0" : "3.0.3",
    info: { title: "t", version: "1" },
    paths: {},
    [version === "3.1" ? "webhooks" : "x-webhooks"]: webhooks,
  };
}

function chargeSucceeded(spec: unknown): unknown { void spec; return { type: "charge.succeeded", data: { object: { id: "ch_1", amount: 100, currency: "usd" } } }; }

describe("readWebhooksMap", () => {
  test("picks up OpenAPI 3.1 webhooks: block", () => {
    const spec = makeSpec({ "charge.succeeded": { post: {} } }, "3.1");
    expect(Object.keys(readWebhooksMap(spec))).toEqual(["charge.succeeded"]);
  });

  test("falls back to x-webhooks for pre-3.1 specs", () => {
    const spec = makeSpec({ "charge.failed": { post: {} } }, "3.0");
    expect(Object.keys(readWebhooksMap(spec))).toEqual(["charge.failed"]);
  });

  test("empty when neither key exists", () => {
    expect(readWebhooksMap({ openapi: "3.1.0", info: { title: "x", version: "1" } })).toEqual({});
    expect(readWebhooksMap(null)).toEqual({});
    expect(readWebhooksMap(undefined as unknown)).toEqual({});
  });
});

describe("parseEventLog", () => {
  test("parses one event per line, skips empty lines", () => {
    const text = `{"type":"a","data":{"object":{}}}\n\n{"type":"b","data":{"object":{}}}\n`;
    const { events, malformed } = parseEventLog(text);
    expect(events.length).toBe(2);
    expect(malformed).toEqual([]);
    expect(events[0]!.line).toBe(1);
    expect(events[1]!.line).toBe(3);
  });

  test("non-JSON lines surface as malformed_event with line pointer", () => {
    const text = `{"type":"a"}\nnot-json\n{"type":"c"}`;
    const { events, malformed } = parseEventLog(text);
    expect(events.length).toBe(2);
    expect(malformed.length).toBe(1);
    expect(malformed[0]!.line).toBe(2);
    expect(malformed[0]!.kind).toBe("malformed_event");
  });

  test("non-object JSON (array, scalar) surfaces as malformed_event", () => {
    const text = `[1,2,3]\n42\n"a string"`;
    const { malformed } = parseEventLog(text);
    expect(malformed.length).toBe(3);
    for (const m of malformed) expect(m.kind).toBe("malformed_event");
  });
});

describe("runWebhooksProbe — shape validation", () => {
  const chargeSchema = {
    type: "object",
    required: ["id", "amount", "currency"],
    properties: {
      id: { type: "string" },
      amount: { type: "integer" },
      currency: { type: "string" },
    },
  };
  const spec = makeSpec({
    "charge.succeeded": {
      post: {
        requestBody: { content: { "application/json": { schema: chargeSchema } } },
      },
    },
  });

  test("skips when spec has no webhooks block", () => {
    const out = runWebhooksProbe({
      spec: { openapi: "3.1.0", info: { title: "x", version: "1" } },
      events: [{ line: 1, event: { type: "x" } }],
    });
    expect(out.skip_reason).toMatch(/no .webhooks/);
    expect(out.findings).toEqual([]);
  });

  test("passes a conformant Stripe-style event", () => {
    const out = runWebhooksProbe({
      spec,
      events: [{ line: 1, event: chargeSucceeded(spec) as Record<string, unknown> }],
    });
    expect(out.findings).toEqual([]);
    expect(out.by_type["charge.succeeded"]).toEqual({ ok: 1, drift: 0, unknown: 0 });
  });

  test("HIGH shape_drift when payload omits required field", () => {
    const out = runWebhooksProbe({
      spec,
      events: [{ line: 1, event: { type: "charge.succeeded", data: { object: { id: "ch_1", amount: 100 } } } }],
    });
    expect(out.findings.length).toBe(1);
    expect(out.findings[0]!.kind).toBe("shape_drift");
    expect(out.findings[0]!.severity).toBe("high");
    expect(out.findings[0]!.event_type).toBe("charge.succeeded");
  });

  test("LOW unknown_event_type for a type not in spec.webhooks", () => {
    const out = runWebhooksProbe({
      spec,
      events: [{ line: 1, event: { type: "ghost.event", data: { object: { id: "x" } } } }],
    });
    expect(out.findings.length).toBe(1);
    expect(out.findings[0]!.kind).toBe("unknown_event_type");
    expect(out.findings[0]!.severity).toBe("low");
  });

  test("LOW missing_payload when neither data.object nor body present", () => {
    const out = runWebhooksProbe({
      spec,
      events: [{ line: 1, event: { type: "charge.succeeded", data: "not-an-object" } }],
    });
    expect(out.findings.length).toBe(1);
    expect(out.findings[0]!.kind).toBe("missing_payload");
  });

  test("LOW malformed_event when no type field", () => {
    const out = runWebhooksProbe({
      spec,
      events: [{ line: 1, event: { data: { object: { id: "x" } } } }],
    });
    expect(out.findings.length).toBe(1);
    expect(out.findings[0]!.kind).toBe("malformed_event");
  });

  test("--only filter restricts validation set", () => {
    const out = runWebhooksProbe({
      spec,
      events: [
        { line: 1, event: { type: "ghost.event" } },
        { line: 2, event: chargeSucceeded(spec) as Record<string, unknown> },
      ],
      onlyTypes: ["charge.succeeded"],
    });
    // ghost.event filtered out before "unknown" classification fires.
    expect(out.findings).toEqual([]);
    expect(out.by_type["charge.succeeded"]).toEqual({ ok: 1, drift: 0, unknown: 0 });
  });

  test("generic envelope: body field used when data.object absent", () => {
    const out = runWebhooksProbe({
      spec,
      events: [{ line: 1, event: { event: "charge.succeeded", body: { id: "ch_2", amount: 50, currency: "usd" } } }],
    });
    expect(out.findings).toEqual([]);
  });

  test("declared events surface in result for digest header", () => {
    const out = runWebhooksProbe({
      spec,
      events: [],
    });
    expect(out.declared_events).toEqual(["charge.succeeded"]);
    expect(out.total_events).toBe(0);
  });

  test("counts: many events, mixed verdicts", () => {
    const events: Array<{ line: number; event: Record<string, unknown> }> = [
      { line: 1, event: chargeSucceeded(spec) as Record<string, unknown> },
      { line: 2, event: { type: "charge.succeeded", data: { object: { id: "x" } } } },     // drift
      { line: 3, event: { type: "unknown.event", data: { object: {} } } },                  // unknown
      { line: 4, event: chargeSucceeded(spec) as Record<string, unknown> },
    ];
    const out = runWebhooksProbe({ spec, events });
    expect(out.by_type["charge.succeeded"]).toEqual({ ok: 2, drift: 1, unknown: 0 });
    expect(out.by_type["unknown.event"]).toEqual({ ok: 0, drift: 0, unknown: 1 });
    const high = out.findings.filter((f: WebhookFinding) => f.severity === "high").length;
    expect(high).toBe(1);
  });
});
