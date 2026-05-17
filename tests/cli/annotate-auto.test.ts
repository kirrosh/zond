/**
 * ARV-262: tests for heuristic auto-annotate inference.
 *
 * Each inferrer takes a ResourceSlice and produces a high-confidence
 * patch when the spec carries clean signals (page+per_page, cursor
 * param, state/status enum, Idempotency-Key header), and null otherwise.
 */

import { describe, test, expect } from "bun:test";
import {
  inferPagination,
  inferLifecycle,
  inferIdempotency,
  inferSeedBody,
  inferAll,
  meetsConfidence,
} from "../../src/cli/commands/api/annotate/auto.ts";
import type { ResourceSlice } from "../../src/cli/commands/api/annotate/prompts.ts";

function slice(overrides: Partial<ResourceSlice> & { resource?: string }): ResourceSlice {
  return {
    resource: overrides.resource ?? "things",
    basePath: "/v1/things",
    itemPath: "/v1/things/{id}",
    endpoints: overrides.endpoints ?? {},
  };
}

describe("inferPagination", () => {
  test("page+per_page → page-style high-confidence", () => {
    const s = slice({
      endpoints: {
        list: {
          method: "GET",
          path: "/v1/issues",
          parameters: [
            { name: "page", in: "query" },
            { name: "per_page", in: "query" },
          ],
          responses: {
            "200": {
              schema: { type: "array" },
            },
          },
        },
      },
    });
    const inf = inferPagination(s);
    expect(inf).not.toBeNull();
    expect(inf!.confidence).toBe("high");
    expect(inf!.patch.pagination?.type).toBe("page");
    expect(inf!.patch.pagination?.page_param).toBe("page");
    expect(inf!.patch.pagination?.limit_param).toBe("per_page");
  });

  test("preserves original-case param name (PageSize)", () => {
    const s = slice({
      endpoints: {
        list: {
          method: "GET",
          path: "/v1/x",
          parameters: [
            { name: "page", in: "query" },
            { name: "PageSize", in: "query" },
          ],
        },
      },
    });
    const inf = inferPagination(s);
    expect(inf!.patch.pagination?.limit_param).toBe("PageSize");
  });

  test("starting_after → cursor-style", () => {
    const s = slice({
      endpoints: {
        list: {
          method: "GET",
          path: "/v1/customers",
          parameters: [{ name: "starting_after", in: "query" }],
          responses: {
            "200": {
              schema: {
                type: "object",
                properties: {
                  data: { type: "array" },
                  has_more: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    });
    const inf = inferPagination(s);
    expect(inf!.confidence).toBe("high");
    expect(inf!.patch.pagination?.type).toBe("cursor");
    expect(inf!.patch.pagination?.cursor_param).toBe("starting_after");
    expect(inf!.patch.pagination?.has_more_field).toBe("has_more");
    expect(inf!.patch.pagination?.items_field).toBe("data");
  });

  test("page_token → cursor-style", () => {
    const s = slice({
      endpoints: {
        list: {
          method: "GET",
          path: "/v1/x",
          parameters: [{ name: "page_token", in: "query" }],
        },
      },
    });
    const inf = inferPagination(s);
    expect(inf!.patch.pagination?.cursor_param).toBe("page_token");
  });

  test("no pagination params → null", () => {
    const s = slice({
      endpoints: {
        list: { method: "GET", path: "/v1/x", parameters: [{ name: "filter", in: "query" }] },
      },
    });
    expect(inferPagination(s)).toBeNull();
  });

  test("no list endpoint → null", () => {
    expect(inferPagination(slice({}))).toBeNull();
  });

  test("page alone (no limit param) → null (avoid noisy half-detect)", () => {
    const s = slice({
      endpoints: {
        list: { method: "GET", path: "/v1/x", parameters: [{ name: "page", in: "query" }] },
      },
    });
    expect(inferPagination(s)).toBeNull();
  });
});

describe("inferLifecycle", () => {
  test("status enum on read response → observation-mode high", () => {
    const s = slice({
      resource: "issues",
      endpoints: {
        read: {
          method: "GET",
          path: "/repos/{o}/{r}/issues/{n}",
          responses: {
            "200": {
              schema: {
                type: "object",
                properties: {
                  state: { type: "string", enum: ["open", "closed"] },
                },
              },
            },
          },
        },
      },
    });
    const inf = inferLifecycle(s);
    expect(inf!.confidence).toBe("high");
    expect(inf!.patch.lifecycle?.field).toBe("state");
    expect(inf!.patch.lifecycle?.states).toEqual(["open", "closed"]);
    expect(inf!.patch.lifecycle?.transitions).toEqual([]);
    expect(inf!.patch.lifecycle?.actions).toEqual({});
  });

  test("falls back to list endpoint response if no read", () => {
    const s = slice({
      endpoints: {
        list: {
          method: "GET",
          path: "/v1/x",
          responses: {
            "200": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["pending", "done", "failed"] },
                },
              },
            },
          },
        },
      },
    });
    const inf = inferLifecycle(s);
    expect(inf!.patch.lifecycle?.field).toBe("status");
    expect(inf!.patch.lifecycle?.states).toHaveLength(3);
  });

  test("single-value enum → null (need ≥2 states)", () => {
    const s = slice({
      endpoints: {
        read: {
          method: "GET",
          path: "/v1/x/{id}",
          responses: {
            "200": { schema: { type: "object", properties: { state: { type: "string", enum: ["only"] } } } },
          },
        },
      },
    });
    expect(inferLifecycle(s)).toBeNull();
  });

  test("no state/status field → null", () => {
    const s = slice({
      endpoints: {
        read: {
          method: "GET",
          path: "/v1/x/{id}",
          responses: {
            "200": { schema: { type: "object", properties: { name: { type: "string" } } } },
          },
        },
      },
    });
    expect(inferLifecycle(s)).toBeNull();
  });
});

describe("inferIdempotency", () => {
  test("Idempotency-Key header on create → high", () => {
    const s = slice({
      resource: "customers",
      endpoints: {
        create: {
          method: "POST",
          path: "/v1/customers",
          parameters: [{ name: "Idempotency-Key", in: "header" }],
        },
      },
    });
    const inf = inferIdempotency(s);
    expect(inf!.confidence).toBe("high");
    expect(inf!.patch.idempotency?.header).toBe("Idempotency-Key");
  });

  test("no create endpoint → null", () => {
    expect(inferIdempotency(slice({}))).toBeNull();
  });

  test("create without idempotency header → null", () => {
    const s = slice({
      endpoints: {
        create: {
          method: "POST",
          path: "/v1/x",
          parameters: [{ name: "Authorization", in: "header" }],
        },
      },
    });
    expect(inferIdempotency(s)).toBeNull();
  });
});

describe("inferSeedBody (ARV-270)", () => {
  function seedSlice(
    requestSchema: Record<string, unknown>,
    contentType = "application/json",
  ): ResourceSlice {
    return {
      resource: "customers",
      basePath: "/v1/customers",
      itemPath: "/v1/customers/{id}",
      endpoints: {
        create: {
          method: "POST",
          path: "/v1/customers",
          requestBody: { contentType, schema: requestSchema },
        },
      },
    };
  }

  test("format-aware string defaults: email/url/date-time/uuid", () => {
    const s = seedSlice({
      type: "object",
      required: ["email", "homepage", "created_at", "ref"],
      properties: {
        email: { type: "string", format: "email" },
        homepage: { type: "string", format: "uri" },
        created_at: { type: "string", format: "date-time" },
        ref: { type: "string", format: "uuid" },
      },
    });
    const inf = inferSeedBody(s);
    expect(inf).not.toBeNull();
    expect(inf!.confidence).toBe("high");
    const body = inf!.patch.seed_body!.body as Record<string, unknown>;
    expect(body.email).toBe("zond-probe@example.com");
    expect(body.homepage).toBe("https://example.com/zond-probe");
    expect(body.created_at).toBe("2025-01-01T00:00:00Z");
    expect(body.ref).toBe("00000000-0000-0000-0000-000000000000");
  });

  test("name-based ISO literals: currency/country, integer amount", () => {
    const s = seedSlice({
      type: "object",
      required: ["currency", "country", "amount", "active"],
      properties: {
        currency: { type: "string" },
        country: { type: "string" },
        amount: { type: "integer" },
        active: { type: "boolean" },
      },
    });
    const inf = inferSeedBody(s);
    expect(inf!.confidence).toBe("high");
    const body = inf!.patch.seed_body!.body as Record<string, unknown>;
    expect(body.currency).toBe("usd");
    expect(body.country).toBe("US");
    expect(body.amount).toBe(1000);
    expect(body.active).toBe(false);
  });

  test("enum first-value wins over format/type defaults", () => {
    const s = seedSlice({
      type: "object",
      required: ["type"],
      properties: { type: { type: "string", enum: ["fixed_amount", "percentage"] } },
    });
    const inf = inferSeedBody(s);
    expect((inf!.patch.seed_body!.body as Record<string, unknown>).type).toBe("fixed_amount");
    expect(inf!.confidence).toBe("high");
  });

  test("FK lookup: required field name found in env → {{var}} template (AC #3)", () => {
    const s = seedSlice({
      type: "object",
      required: ["customer", "audience_id", "display_name"],
      properties: {
        customer: { type: "string" },
        audience_id: { type: "string" },
        display_name: { type: "string" },
      },
    });
    const env = { customer: "cus_xyz", audience_id: "aud_42" };
    const inf = inferSeedBody(s, env);
    const body = inf!.patch.seed_body!.body as Record<string, unknown>;
    expect(body.customer).toBe("{{customer}}");
    expect(body.audience_id).toBe("{{audience_id}}");
    expect(body.display_name).toBe("zond-probe");
    expect(inf!.rationale).toMatch(/2 FK from env/);
  });

  test("FK lookup: <name>_id-stripped stem also matches env (customer_id → env.customer)", () => {
    const s = seedSlice({
      type: "object",
      required: ["customer_id"],
      properties: { customer_id: { type: "string" } },
    });
    const inf = inferSeedBody(s, { customer: "cus_xyz" });
    expect((inf!.patch.seed_body!.body as Record<string, unknown>).customer_id).toBe("{{customer}}");
  });

  test("placeholder env values (TODO, 'string') do not count as FK hits", () => {
    const s = seedSlice({
      type: "object",
      required: ["customer"],
      properties: { customer: { type: "string" } },
    });
    const inf = inferSeedBody(s, { customer: "TODO" });
    // FK lookup falls through to name-based fallback (`zond-probe-customer`).
    const body = inf!.patch.seed_body!.body as Record<string, unknown>;
    expect(body.customer).toMatch(/^zond-probe/);
  });

  test("generic string fallback drops confidence to medium", () => {
    const s = seedSlice({
      type: "object",
      required: ["some_field"],
      properties: { some_field: { type: "string" } },
    });
    const inf = inferSeedBody(s);
    expect(inf!.confidence).toBe("medium");
    expect((inf!.patch.seed_body!.body as Record<string, unknown>).some_field)
      .toMatch(/^zond-probe-some_field/);
  });

  test("content_type from spec is propagated into the patch", () => {
    const s = seedSlice(
      { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      "application/x-www-form-urlencoded",
    );
    const inf = inferSeedBody(s);
    expect(inf!.patch.seed_body!.content_type).toBe("application/x-www-form-urlencoded");
  });

  test("nested required object → null (defer to agent-loop)", () => {
    const s = seedSlice({
      type: "object",
      required: ["billing"],
      properties: {
        billing: {
          type: "object",
          required: ["address", "card"],
          properties: { address: { type: "string" }, card: { type: "string" } },
        },
      },
    });
    expect(inferSeedBody(s)).toBeNull();
  });

  test("oneOf union → null (discriminator XOR is agent-territory)", () => {
    const s = seedSlice({
      type: "object",
      required: ["amount"],
      oneOf_first: { properties: { percent_off: { type: "integer" } } },
      properties: { amount: { type: "integer" } },
    });
    expect(inferSeedBody(s)).toBeNull();
  });

  test("no create endpoint → null", () => {
    const s: ResourceSlice = {
      resource: "x",
      basePath: "/x",
      itemPath: "/x/{id}",
      endpoints: {},
    };
    expect(inferSeedBody(s)).toBeNull();
  });

  test("no required → null (don't pollute overlay with empty bodies)", () => {
    const s = seedSlice({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(inferSeedBody(s)).toBeNull();
  });

  test("required field with un-fabricable type (object w/o required) → null", () => {
    // top-level required points at an opaque object; we can't guess
    // its shape and shouldn't ship `{}` because validators reject it.
    const s = seedSlice({
      type: "object",
      required: ["metadata"],
      properties: { metadata: { type: "object" } },
    });
    // `object` without `required` falls through pickSeedValue → undefined → null.
    expect(inferSeedBody(s)).toBeNull();
  });
});

describe("inferAll + confidence filter", () => {
  test("inferAll runs every aspect per slice and skips nulls", () => {
    const s = slice({
      resource: "issues",
      endpoints: {
        list: {
          method: "GET",
          path: "/repos/{o}/{r}/issues",
          parameters: [
            { name: "page", in: "query" },
            { name: "per_page", in: "query" },
          ],
          responses: {
            "200": {
              schema: {
                type: "object",
                properties: {
                  state: { type: "string", enum: ["open", "closed"] },
                },
              },
            },
          },
        },
        create: {
          method: "POST",
          path: "/repos/{o}/{r}/issues",
          parameters: [{ name: "Idempotency-Key", in: "header" }],
        },
      },
    });
    const all = inferAll([s], ["pagination", "lifecycle", "idempotency"]);
    const aspects = new Set(all.map((i) => i.aspect));
    expect(aspects.has("pagination")).toBe(true);
    expect(aspects.has("lifecycle")).toBe(true);
    expect(aspects.has("idempotency")).toBe(true);
  });

  test("meetsConfidence threshold", () => {
    expect(meetsConfidence("high", "high")).toBe(true);
    expect(meetsConfidence("medium", "high")).toBe(false);
    expect(meetsConfidence("high", "medium")).toBe(true);
    expect(meetsConfidence("low", "low")).toBe(true);
  });
});
