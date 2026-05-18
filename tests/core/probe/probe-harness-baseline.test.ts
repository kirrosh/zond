import { describe, test, expect } from "bun:test";
import type { OpenAPIV3 } from "openapi-types";
import { buildBaselineFromSpec } from "../../../src/core/probe/probe-harness.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";

/**
 * ARV-164: probe security / mass-assignment build their baseline POST body
 * via `buildBaselineFromSpec`, which routes through the generator's
 * `generateFromSchema` cascade. After ARV-165 added format-aware helpers,
 * baselines for format-validated fields (country/currency/MCC/color/IP/url)
 * stop being plain `{{$randomString}}` — this pins that contract so a
 * future refactor of the baseline path can't silently regress.
 *
 * Pre-fix repro: 15/265 INCONCLUSIVE-BASE on Stripe-class APIs (R09
 * finding F18-tail) because the baseline 400'd before the probe payload
 * could be compared.
 */

function mkEndpoint(schema: OpenAPIV3.SchemaObject): EndpointInfo {
  return {
    operationId: "op",
    method: "POST",
    path: "/v1/test",
    requestBodySchema: schema,
    requestBodyContentType: "application/json",
    securitySchemes: [],
  } as unknown as EndpointInfo;
}

describe("ARV-164: buildBaselineFromSpec inherits format-aware cascade", () => {
  const vars: Record<string, string> = { base_url: "https://api.example.com" };

  test("email field → @-shaped baseline value", () => {
    const ep = mkEndpoint({
      type: "object",
      properties: { email: { type: "string", format: "email" } as OpenAPIV3.SchemaObject },
    });
    const baseline = buildBaselineFromSpec(ep, vars)!;
    expect(typeof baseline.email).toBe("string");
    expect(baseline.email).toMatch(/@/);
  });

  test("url field → http(s)-shaped baseline", () => {
    const ep = mkEndpoint({
      type: "object",
      properties: { url: { type: "string", format: "url" } as OpenAPIV3.SchemaObject },
    });
    const baseline = buildBaselineFromSpec(ep, vars)!;
    expect(baseline.url).toMatch(/^https?:\/\//);
  });

  test("country / currency name-heuristic → ISO literals", () => {
    const ep = mkEndpoint({
      type: "object",
      properties: {
        country: { type: "string" } as OpenAPIV3.SchemaObject,
        currency: { type: "string" } as OpenAPIV3.SchemaObject,
      },
    });
    const baseline = buildBaselineFromSpec(ep, vars)!;
    expect(baseline.country).toBe("US");
    expect(baseline.currency).toBe("USD");
  });

  test("mcc field → 4-digit numeric baseline", () => {
    const ep = mkEndpoint({
      type: "object",
      properties: { mcc: { type: "string" } as OpenAPIV3.SchemaObject },
    });
    const baseline = buildBaselineFromSpec(ep, vars)!;
    expect(baseline.mcc).toMatch(/^\d{4}$/);
  });

  test("hex color baseline (#RRGGBB)", () => {
    const ep = mkEndpoint({
      type: "object",
      properties: { background_color: { type: "string" } as OpenAPIV3.SchemaObject },
    });
    const baseline = buildBaselineFromSpec(ep, vars)!;
    expect(baseline.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("ip field → dotted-quad baseline", () => {
    const ep = mkEndpoint({
      type: "object",
      properties: { ip: { type: "string" } as OpenAPIV3.SchemaObject },
    });
    const baseline = buildBaselineFromSpec(ep, vars)!;
    expect(baseline.ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });

  test("non-object schema returns null (existing contract)", () => {
    const ep = mkEndpoint({ type: "string" } as OpenAPIV3.SchemaObject);
    expect(buildBaselineFromSpec(ep, vars)).toBeNull();
  });
});

describe("ARV-269: seed_body overlay wins over generator", () => {
  const vars: Record<string, string> = { base_url: "https://api.example.com" };

  test("overlay body replaces generator output", () => {
    // Generator would produce { name: "{{$randomString}}", amount: <number> }.
    // Overlay carries exact values an agent observed the API accepts.
    const ep = mkEndpoint({
      type: "object",
      properties: {
        name: { type: "string" } as OpenAPIV3.SchemaObject,
        amount: { type: "integer" } as OpenAPIV3.SchemaObject,
      },
    });
    const baseline = buildBaselineFromSpec(ep, vars, {
      body: { name: "zond-overlay", amount: 500 },
    })!;
    expect(baseline.name).toBe("zond-overlay");
    expect(baseline.amount).toBe(500);
  });

  test("overlay body still resolves {{var}} markers", () => {
    const ep = mkEndpoint({ type: "object", properties: {} });
    const baseline = buildBaselineFromSpec(ep, { ...vars, customer_id: "cus_123" }, {
      body: { customer: "{{customer_id}}" },
    })!;
    expect(baseline.customer).toBe("cus_123");
  });

  test("undefined seedBody → falls back to generator (legacy contract)", () => {
    const ep = mkEndpoint({
      type: "object",
      properties: { email: { type: "string", format: "email" } as OpenAPIV3.SchemaObject },
    });
    const baseline = buildBaselineFromSpec(ep, vars)!;
    expect(baseline.email).toMatch(/@/);
  });
});
