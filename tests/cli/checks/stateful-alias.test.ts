/**
 * ARV-325: `--check stateful` must expand to the state-machine set only.
 * ignored_auth / open_cors_on_sensitive live in the stateful registry (they
 * need the stateful harness) but are auth/security checks — including them
 * through the alias tripled run time on wide APIs and surprised callers.
 */
import { describe, test, expect } from "bun:test";
import { expandStatefulAlias } from "../../../src/cli/commands/checks.ts";
import { listStatefulChecks } from "../../../src/core/checks/stateful.ts";
import "../../../src/core/checks/checks/index.ts"; // register built-ins

describe("expandStatefulAlias (ARV-325)", () => {
  test("'stateful' excludes ignored_auth / open_cors_on_sensitive", () => {
    const out = expandStatefulAlias(["stateful"])!;
    expect(out).not.toContain("ignored_auth");
    expect(out).not.toContain("open_cors_on_sensitive");
    // Everything else in the stateful registry is included.
    const expected = listStatefulChecks()
      .map((c) => c.id)
      .filter((id) => id !== "ignored_auth" && id !== "open_cors_on_sensitive");
    expect(out.sort()).toEqual(expected.sort());
    expect(out.length).toBeGreaterThan(0);
  });

  test("explicit ids pass through untouched (security pair still runnable)", () => {
    expect(expandStatefulAlias(["ignored_auth", "open_cors_on_sensitive"]))
      .toEqual(["ignored_auth", "open_cors_on_sensitive"]);
  });
});
