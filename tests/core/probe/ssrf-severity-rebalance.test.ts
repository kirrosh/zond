/**
 * SSRF severity rebalance regression (ARV-254, m-21 pivot).
 *
 * Locks the post-pivot severity matrix for the SSRF class without an
 * out-of-band channel:
 *
 * - Plain endpoint (no webhook semantics in path/tags), URL echoed
 *   back → LOW with explicit OOB disclaimer.
 * - Plain endpoint, URL accepted but not echoed → LOW with OOB
 *   disclaimer.
 * - Endpoint declares delivery (path contains "webhook" / "callback"
 *   / "subscription" or tag matches), URL accepted (no echo) → MEDIUM
 *   with OOB disclaimer.
 *
 * HIGH is reserved for OOB-confirmed fetches; that infrastructure is
 * deferred-post-pivot (ARV-177) so no probe path emits HIGH today.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { runSecurityProbes } from "../../../src/core/probe/security-probe.ts";
import { postEp as ep } from "../../_helpers/endpoints";
import { fetchHarness } from "./_helpers/state-machine";

const webhookSchema = {
  type: "object" as const,
  required: ["url"],
  properties: {
    url: { type: "string" as const, format: "uri" },
  },
};

const harness = fetchHarness();
beforeEach(() => harness.install());
afterEach(() => harness.restore());

describe("SSRF severity rebalance (ARV-254)", () => {
  it("LOW on a plain endpoint when URL is echoed back (no OOB)", async () => {
    harness.setResponder((req) => {
      if (req.method === "DELETE") return { status: 204 };
      const body = req.body as Record<string, unknown> | undefined;
      const url = body?.url;
      // Plain "/links" endpoint — no delivery declaration. Echoed payload
      // alone caps at LOW.
      return { status: 201, body: { id: "lnk", url } };
    });
    const result = await runSecurityProbes({
      allowLeaks: true,
      endpoints: [ep({ method: "POST", path: "/links", requestBodySchema: webhookSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("low");
    expect(v.findings[0]!.reason).toMatch(/OOB/i);
  });

  it("LOW on a plain endpoint when URL accepted but not echoed (no OOB)", async () => {
    // Each response carries a unique id so the baseline-echo anti-FP
    // rule (ARV-126) does NOT fire — without this the rule deep-equals
    // the baseline and attack bodies, downgrades severity to "ok", and
    // the test flakes whenever this file runs after another test that
    // bootstraps the anti-FP registry (order-dependent on CI).
    let n = 0;
    harness.setResponder((req) => {
      if (req.method === "DELETE") return { status: 204 };
      return { status: 201, body: { id: `lnk_${n++}` } };
    });
    const result = await runSecurityProbes({
      allowLeaks: true,
      endpoints: [ep({ method: "POST", path: "/links", requestBodySchema: webhookSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("low");
    expect(v.findings[0]!.reason).toMatch(/OOB/i);
  });

  it("MEDIUM when endpoint path declares delivery semantics (webhook)", async () => {
    harness.setResponder((req) => {
      if (req.method === "DELETE") return { status: 204 };
      // Accept but don't echo — would normally be LOW, but the path
      // says "webhooks" so delivery is documented.
      return { status: 201, body: { id: "wh" } };
    });
    const result = await runSecurityProbes({
      allowLeaks: true,
      endpoints: [ep({ method: "POST", path: "/webhooks", requestBodySchema: webhookSchema })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("medium");
    const med = v.findings.filter((f) => f.severity === "medium");
    expect(med.length).toBeGreaterThan(0);
    expect(med[0]!.reason).toMatch(/declaring delivery/);
    expect(med[0]!.reason).toMatch(/OOB/i);
  });

  it("MEDIUM also fires when tag mentions webhook even if path doesn't", async () => {
    harness.setResponder((req) => {
      if (req.method === "DELETE") return { status: 204 };
      return { status: 201, body: { id: "wh" } };
    });
    const result = await runSecurityProbes({
      allowLeaks: true,
      endpoints: [ep({
        method: "POST",
        path: "/subscriptions",
        requestBodySchema: webhookSchema,
        tags: ["Webhook subscriptions"],
      })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("medium");
  });
});
