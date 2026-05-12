import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runSecurityProbes } from "../../../src/core/probe/security-probe.ts";
import { ep } from "../../_helpers/endpoints";
import type { OpenAPIV3 } from "openapi-types";
import { fetchHarness } from "./_helpers/state-machine";

// ARV-140: pre-flight cleanup-feasibility pass. POST endpoints without a
// DELETE counterpart in the spec are dropped by default — the CLI has no
// cleanup path, so any 2xx leaves a resource in the user's tenant forever
// (Sentry round-01/02: 18 manual cleanups across /teams /symbol-sources
// /user-feedback /keys). --allow-leaks bypasses the gate.

const webhookSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["url"],
  properties: { url: { type: "string", format: "uri" } },
};

const harness = fetchHarness();
beforeEach(() => harness.install());
afterEach(() => harness.restore());

describe("runSecurityProbes cleanup-feasibility (ARV-140)", () => {
  it("POST without DELETE counterpart is skipped by default (no HTTP call)", async () => {
    let calls = 0;
    harness.setResponder(() => { calls++; return { status: 201, body: { id: "x" } }; });

    const result = await runSecurityProbes({
      endpoints: [ep({
        method: "POST",
        path: "/teams",
        requestBodyContentType: "application/json",
        requestBodySchema: webhookSchema,
      })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });

    expect(calls).toBe(0);
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("skipped");
    expect(v.skipReason ?? "").toMatch(/no DELETE counterpart/);
    expect(result.cleanupFeasibility?.skippedNoCleanup).toBe(1);
    expect(result.cleanupFeasibility?.status["POST /teams"]).toBe("no-delete-counterpart");
  });

  it("--allow-leaks forces the attack and bumps forcedNoCleanup", async () => {
    let calls = 0;
    harness.setResponder(() => { calls++; return { status: 400, body: {} }; });

    const result = await runSecurityProbes({
      endpoints: [ep({
        method: "POST",
        path: "/teams",
        requestBodyContentType: "application/json",
        requestBodySchema: webhookSchema,
      })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
      allowLeaks: true,
    });

    expect(calls).toBeGreaterThan(0);
    expect(result.cleanupFeasibility?.skippedNoCleanup).toBe(0);
    expect(result.cleanupFeasibility?.forcedNoCleanup).toBe(1);
  });

  it("POST with DELETE counterpart proceeds (no skip)", async () => {
    let calls = 0;
    harness.setResponder(() => { calls++; return { status: 400, body: {} }; });

    const result = await runSecurityProbes({
      endpoints: [
        ep({
          method: "POST",
          path: "/webhooks",
          requestBodyContentType: "application/json",
          requestBodySchema: webhookSchema,
        }),
        ep({
          method: "DELETE",
          path: "/webhooks/{webhook_id}",
        }),
      ],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
    });

    expect(calls).toBeGreaterThan(0);
    expect(result.cleanupFeasibility?.skippedNoCleanup).toBe(0);
    expect(result.cleanupFeasibility?.status["POST /webhooks"]).toBe("has-delete");
  });
});
