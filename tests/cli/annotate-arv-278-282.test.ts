/**
 * ARV-278/279/280/281/282 — agent-loop UX extensions on top of ARV-277.
 * Heavy integration aspects (DB queries, live HTTP calls) covered in
 * tests/db/last-fixture-post.test.ts and the Stripe live scan; this
 * file focuses on the pure helpers that drive the new flags.
 */

import { describe, test, expect } from "bun:test";
import {
  filterToGaps,
  classifyAttempts,
  urlMatchesCreatePath,
} from "../../src/cli/commands/api/annotate/index.ts";
import type { ResourcePatch } from "../../src/cli/commands/api/annotate/overlay.ts";

describe("filterToGaps (ARV-281 gap-fill-only)", () => {
  test("drops aspect-level fields already set in the existing overlay", () => {
    const existing: ResourcePatch[] = [
      {
        resource: "customers",
        seed_body: {
          content_type: "application/x-www-form-urlencoded",
          body: { email: "curated@example.com" },
        },
      },
    ];
    const proposed: ResourcePatch = {
      resource: "customers",
      seed_body: { content_type: "application/json", body: { name: "agent" } },
      pagination: { type: "cursor", cursor_param: "after" },
    };
    const filtered = filterToGaps(proposed, existing);
    // seed_body was set → dropped; pagination is new → kept.
    expect(filtered.seed_body).toBeUndefined();
    expect(filtered.pagination).toEqual({ type: "cursor", cursor_param: "after" });
    expect(filtered.resource).toBe("customers");
  });

  test("keeps everything when the resource isn't in the existing overlay", () => {
    const proposed: ResourcePatch = {
      resource: "new_resource",
      seed_body: { content_type: "application/json", body: { x: 1 } },
    };
    expect(filterToGaps(proposed, [])).toEqual(proposed);
  });

  test("treats undefined/null aspect-fields as unset (lets agent fill)", () => {
    const existing: ResourcePatch[] = [
      {
        resource: "customers",
        seed_body: undefined,
      } as ResourcePatch,
    ];
    const proposed: ResourcePatch = {
      resource: "customers",
      seed_body: { content_type: "application/json", body: { name: "x" } },
    };
    const filtered = filterToGaps(proposed, existing);
    expect(filtered.seed_body).toBeDefined();
  });

  test("keeps any non-empty existing block (conservative — don't overwrite structure)", () => {
    // Even an idempotency block whose `header` is empty string counts as
    // "set" — the agent's response shouldn't blindly overwrite curated
    // structure. Force-flag opts out (covered in renderer-level tests).
    const existing: ResourcePatch[] = [
      {
        resource: "customers",
        idempotency: { header: "" },
      } as ResourcePatch,
    ];
    const proposed: ResourcePatch = {
      resource: "customers",
      idempotency: { header: "Idempotency-Key" },
    };
    expect(filterToGaps(proposed, existing).idempotency).toBeUndefined();
  });

  test("never mutates the input patch", () => {
    const proposed: ResourcePatch = {
      resource: "customers",
      seed_body: { content_type: "application/json", body: { name: "x" } },
    };
    const existing: ResourcePatch[] = [
      {
        resource: "customers",
        seed_body: { content_type: "application/json", body: { name: "y" } },
      },
    ];
    const before = JSON.stringify(proposed);
    filterToGaps(proposed, existing);
    expect(JSON.stringify(proposed)).toBe(before);
  });
});

describe("classifyAttempts (ARV-280/330 hard-blocked verdict)", () => {
  const cap = '{"error":{"message":"You can only create new accounts if you\'ve signed up for Connect"}}';
  const dataErr = '{"error":{"message":"Received both external_account and bank_account"}}';
  const authNoise = '{"error":{"message":"Invalid API Key provided: aaa"}}';

  test("no attempts → null", () => {
    expect(classifyAttempts([])).toBeNull();
  });

  test("a 2xx success → never hard-blocked", () => {
    expect(classifyAttempts([
      { response_status: 200, response_body: '{"id":"acct_1"}' },
      { response_status: 400, response_body: cap },
    ])).toBeNull();
  });

  test("only data-shaped 400s → null (not a capability gate)", () => {
    expect(classifyAttempts([
      { response_status: 400, response_body: dataErr },
      { response_status: 400, response_body: dataErr },
    ])).toBeNull();
  });

  test("ARV-330: one capability hit among data-noise, no success → hard-blocked", () => {
    // The chicken-and-egg case: a generic-generator body 400s on data while
    // a leaner check/probe body hits the Connect gate.
    expect(classifyAttempts([
      { response_status: 400, response_body: dataErr },
      { response_status: 400, response_body: cap },
    ])).toBe("account_capability_missing");
  });

  test("ARV-330: auth-probe noise is dropped before judging", () => {
    // 401s + 'Invalid API Key' come from the auth probe's broken creds;
    // if we didn't drop them the lone capability 400 would be diluted.
    expect(classifyAttempts([
      { response_status: 401, response_body: authNoise },
      { response_status: 403, response_body: '{"error":{"message":"The provided key \'sk_test_x\' ..."}}' },
      { response_status: 400, response_body: cap },
    ])).toBe("account_capability_missing");
  });

  test("only auth noise → null (no real evidence)", () => {
    expect(classifyAttempts([
      { response_status: 401, response_body: authNoise },
    ])).toBeNull();
  });

  test("ARV-330: 'signed up for connect' phrasing is recognized", () => {
    expect(classifyAttempts([
      { response_status: 400, response_body: cap },
    ])).toBe("account_capability_missing");
  });
});

describe("urlMatchesCreatePath (ARV-330 sub-resource guard)", () => {
  test("exact create-path matches (with query string)", () => {
    expect(urlMatchesCreatePath("https://api.stripe.com/v1/accounts", "/v1/accounts")).toBe(true);
    expect(urlMatchesCreatePath("https://api.stripe.com/v1/accounts?expand=x", "/v1/accounts")).toBe(true);
  });

  test("child sub-resource POST does NOT match", () => {
    expect(urlMatchesCreatePath("https://api.stripe.com/v1/accounts/acct_1/reject", "/v1/accounts")).toBe(false);
    expect(urlMatchesCreatePath("https://api.stripe.com/v1/accounts/acct_1/persons", "/v1/accounts")).toBe(false);
  });

  test("path-param segment matches any single segment", () => {
    expect(urlMatchesCreatePath("https://api.stripe.com/v1/customers/cus_9/sources", "/v1/customers/{id}/sources")).toBe(true);
    expect(urlMatchesCreatePath("https://api.stripe.com/v1/customers/cus_9/sources/src_1", "/v1/customers/{id}/sources")).toBe(false);
  });

  test("garbage url → false, never throws", () => {
    expect(urlMatchesCreatePath("not a url", "/v1/accounts")).toBe(false);
  });
});
