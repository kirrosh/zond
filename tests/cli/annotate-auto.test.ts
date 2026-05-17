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
