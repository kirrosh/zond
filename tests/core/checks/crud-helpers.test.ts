/**
 * ARV-191: serializeCheckBody — form-urlencoded vs JSON dispatch.
 *
 * Stateful CRUD checks (cross_call_references, idempotency_replay,
 * use_after_free, ensure_resource_availability) used to JSON-stringify
 * the generated body unconditionally. Stripe-style APIs declare
 * `application/x-www-form-urlencoded` on every mutating endpoint, so a
 * JSON payload was silently ignored and surfaced as "400 missing
 * required param" the broken-baseline guard then swallowed.
 */
import { describe, test, expect } from "bun:test";
import { serializeCheckBody } from "../../../src/core/checks/checks/_crud-helpers.ts";

describe("serializeCheckBody", () => {
  test("JSON when content-type is application/json", () => {
    const out = serializeCheckBody({ requestBodyContentType: "application/json" }, { name: "Alice", active: true });
    expect(out.contentType).toBe("application/json");
    expect(JSON.parse(out.body)).toEqual({ name: "Alice", active: true });
  });

  test("JSON when content-type is omitted (default)", () => {
    const out = serializeCheckBody({}, { name: "Alice" });
    expect(out.contentType).toBe("application/json");
    expect(out.body).toBe('{"name":"Alice"}');
  });

  test("form-urlencoded when content-type declares it (Stripe v1 pattern)", () => {
    const out = serializeCheckBody(
      { requestBodyContentType: "application/x-www-form-urlencoded" },
      { name: "Alice", active: true },
    );
    expect(out.contentType).toBe("application/x-www-form-urlencoded");
    // Parse with URLSearchParams to assert encoding regardless of key
    // order — the encoder doesn't promise a stable order.
    const parsed = new URLSearchParams(out.body);
    expect(parsed.get("name")).toBe("Alice");
    expect(parsed.get("active")).toBe("true");
  });

  test("form-urlencoded with nested objects uses bracket notation", () => {
    const out = serializeCheckBody(
      { requestBodyContentType: "application/x-www-form-urlencoded" },
      { address: { line1: "x", line2: "y" } },
    );
    expect(out.body).toContain("address%5Bline1%5D=x");
    expect(out.body).toContain("address%5Bline2%5D=y");
  });

  test("resolves {{$random*}} markers from data-factory before serialising (JSON)", () => {
    const out = serializeCheckBody(
      { requestBodyContentType: "application/json" },
      { name: "{{$randomString}}", balance: "{{$randomInt}}" },
    );
    const parsed = JSON.parse(out.body) as { name: string; balance: string | number };
    expect(parsed.name).not.toContain("{{");
    expect(parsed.name.length).toBeGreaterThan(0);
    // $randomInt returns a number, JSON preserves the type.
    expect(typeof parsed.balance).toBe("number");
  });

  test("resolves placeholders before form-encoding (Stripe pattern)", () => {
    const out = serializeCheckBody(
      { requestBodyContentType: "application/x-www-form-urlencoded" },
      { description: "{{$randomString}}", balance: "{{$randomInt}}" },
    );
    expect(out.body).not.toContain("%7B%7B");
    expect(out.body).not.toContain("{{");
    const parsed = new URLSearchParams(out.body);
    expect(parsed.get("description")?.length).toBeGreaterThan(0);
    expect(parsed.get("balance")).toMatch(/^\d+$/);
  });

  test("env vars override built-in random generators", () => {
    const out = serializeCheckBody(
      { requestBodyContentType: "application/json" },
      { parent_id: "{{audience_id}}" },
      { audience_id: "aud_123" },
    );
    expect(JSON.parse(out.body)).toEqual({ parent_id: "aud_123" });
  });

  test("preserves unknown content-types verbatim (no encoding)", () => {
    const out = serializeCheckBody(
      { requestBodyContentType: "multipart/form-data" },
      { name: "Alice" },
    );
    // multipart isn't form-urlencoded — falls through to JSON.stringify
    // because the helper has no multipart serialiser. Caller's
    // responsibility to skip such endpoints; this just makes the
    // fall-through observable in tests.
    expect(out.contentType).toBe("multipart/form-data");
    expect(out.body).toBe('{"name":"Alice"}');
  });
});
