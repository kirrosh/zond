/**
 * ARV-278/279/280/281/282 — agent-loop UX extensions on top of ARV-277.
 * Heavy integration aspects (DB queries, live HTTP calls) covered in
 * tests/db/last-fixture-post.test.ts and the Stripe live scan; this
 * file focuses on the pure helpers that drive the new flags.
 */

import { describe, test, expect } from "bun:test";
import {
  filterToGaps,
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
