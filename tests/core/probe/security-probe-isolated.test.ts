import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runSecurityProbes } from "../../../src/core/probe/security-probe.ts";
import { ep } from "../../_helpers/endpoints";
import type { OpenAPIV3 } from "openapi-types";
import { fetchHarness } from "./_helpers/state-machine";

// TASK-264: --isolated mode skips PUT/PATCH attacks on endpoints whose
// path-params are filled from .env.yaml (seeded fixtures), so a probe
// run can't corrupt the user's bootstrapped state.

const webhookSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["url"],
  properties: { url: { type: "string", format: "uri" } },
};

const harness = fetchHarness();
beforeEach(() => harness.install());
afterEach(() => harness.restore());

describe("runSecurityProbes --isolated (TASK-264)", () => {
  it("PUT /webhooks/{webhook_id} with seeded fixture → SKIPPED, no HTTP", async () => {
    let calls = 0;
    harness.setResponder(() => { calls++; return { status: 200, body: {} }; });

    const result = await runSecurityProbes({
      endpoints: [ep({
        method: "PUT",
        path: "/webhooks/{webhook_id}",
        requestBodyContentType: "application/json",
        requestBodySchema: webhookSchema,
      })],
      securitySchemes: [],
      vars: { base_url: "https://api.test", webhook_id: "wh_real_42" },
      classes: ["ssrf"],
      isolated: true,
    });

    expect(calls).toBe(0);
    const v = result.verdicts[0]!;
    expect(v.severity).toBe("skipped");
    expect(v.skipReason ?? "").toMatch(/--isolated/);
  });

  it("without --isolated, the same PUT proceeds (sends HTTP)", async () => {
    let calls = 0;
    harness.setResponder(() => { calls++; return { status: 404, body: {} }; });

    const result = await runSecurityProbes({
      endpoints: [ep({
        method: "PUT",
        path: "/webhooks/{webhook_id}",
        requestBodyContentType: "application/json",
        requestBodySchema: webhookSchema,
      })],
      securitySchemes: [],
      vars: { base_url: "https://api.test", webhook_id: "wh_real_42" },
      classes: ["ssrf"],
      // isolated omitted
    });

    // Baseline call landed; verdict isn't "skipped" with the isolated reason.
    expect(calls).toBeGreaterThan(0);
    const v = result.verdicts[0]!;
    expect((v.skipReason ?? "")).not.toMatch(/--isolated/);
  });

  it("POST /webhooks under --isolated still runs (creates fresh resource)", async () => {
    let calls = 0;
    harness.setResponder(() => { calls++; return { status: 201, body: { id: "x" } }; });

    const result = await runSecurityProbes({
      endpoints: [ep({
        method: "POST",
        path: "/webhooks",
        requestBodyContentType: "application/json",
        requestBodySchema: webhookSchema,
      })],
      securitySchemes: [],
      vars: { base_url: "https://api.test" },
      classes: ["ssrf"],
      isolated: true,
    });

    expect(calls).toBeGreaterThan(0);
    const v = result.verdicts[0]!;
    expect((v.skipReason ?? "")).not.toMatch(/--isolated/);
  });
});
