import { describe, test, expect } from "bun:test";
import { preflightCheckVars } from "../../src/core/runner/preflight-vars.ts";
import type { TestSuite } from "../../src/core/parser/types.ts";

function suite(partial: Partial<TestSuite>): TestSuite {
  return {
    name: "S",
    config: { timeout: 10000, retries: 0, retry_delay: 0, follow_redirects: false, verify_ssl: true },
    tests: [],
    ...partial,
  };
}

describe("preflightCheckVars", () => {
  test("flags undefined {{var}} not present in env", () => {
    const s = suite({
      tests: [
        { name: "T", method: "GET", path: "/x?n={{nonexistent_var}}", expect: {} },
      ],
    });
    const hits = preflightCheckVars([s], { base: "x" });
    expect(hits.map(h => h.variable)).toContain("nonexistent_var");
  });

  test("does not flag built-in $generators", () => {
    const s = suite({
      tests: [
        { name: "T", method: "POST", path: "/x", json: { id: "{{$uuid}}", ts: "{{$timestamp}}" }, expect: {} },
      ],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("recognises captures from any step in the suite as known", () => {
    const s = suite({
      tests: [
        {
          name: "create",
          method: "POST",
          path: "/u",
          expect: { body: { id: { capture: "user_id" } } },
        },
        {
          name: "get",
          method: "GET",
          path: "/u/{{user_id}}",
          expect: {},
        },
      ],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("recognises parameterize and set keys as known", () => {
    const s = suite({
      parameterize: { tier: ["a", "b"] },
      tests: [
        {
          name: "T",
          method: "GET",
          path: "/x/{{tier}}/{{computed}}",
          set: { computed: "value" },
          expect: {},
        },
      ],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("flags {{auth_token}} when env doesn't have it", () => {
    const s = suite({
      headers: { Authorization: "Bearer {{auth_token}}" },
      tests: [{ name: "T", method: "GET", path: "/x", expect: {} }],
    });
    const hits = preflightCheckVars([s], {});
    expect(hits.find(h => h.variable === "auth_token")).toBeDefined();
  });
});
