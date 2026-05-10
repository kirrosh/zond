/**
 * Unit tests for the checks registry — covers ARV-1 acceptance criterion #4.
 */
import { describe, test, expect, beforeEach, beforeAll, afterAll } from "bun:test";

import {
  __resetRegistryForTests,
  __snapshotRegistryForTests,
  listChecks,
  getCheck,
  registerCheck,
  selectChecks,
} from "../../../src/core/checks/registry.ts";
import type { Check } from "../../../src/core/checks/types.ts";

// Built-in checks register on import via side effects (see
// `core/checks/checks/index.ts`). Pull them in here so the snapshot taken in
// `beforeAll` includes them — otherwise the registry tests run before
// anything has populated it and `restore()` would put back an empty Map.
import "../../../src/core/checks/index.ts";

function fakeCheck(id: string, severity: Check["severity"] = "low"): Check {
  return {
    id,
    severity,
    defaultExpected: `expected ${id}`,
    references: [{ id: "TEST" }],
    applies: () => true,
    run: () => ({ kind: "pass" }),
  };
}

describe("checks registry", () => {
  let restore: () => void;
  beforeAll(() => { restore = __snapshotRegistryForTests(); });
  afterAll(() => { restore(); });
  beforeEach(() => __resetRegistryForTests());

  test("registerCheck + listChecks returns sorted by id", () => {
    registerCheck(fakeCheck("zebra"));
    registerCheck(fakeCheck("alpha"));
    const ids = listChecks().map((c) => c.id);
    expect(ids).toEqual(["alpha", "zebra"]);
  });

  test("registerCheck rejects duplicates", () => {
    registerCheck(fakeCheck("dup"));
    expect(() => registerCheck(fakeCheck("dup"))).toThrow(/already registered/);
  });

  test("getCheck returns undefined for unknown id", () => {
    expect(getCheck("nope")).toBeUndefined();
  });

  test("selectChecks include narrows the set", () => {
    registerCheck(fakeCheck("a"));
    registerCheck(fakeCheck("b"));
    registerCheck(fakeCheck("c"));
    const sel = selectChecks({ include: ["a", "c"] });
    expect(sel.selected.map((c) => c.id)).toEqual(["a", "c"]);
    expect(sel.unknown).toEqual([]);
  });

  test("selectChecks exclude removes from the set", () => {
    registerCheck(fakeCheck("a"));
    registerCheck(fakeCheck("b"));
    registerCheck(fakeCheck("c"));
    const sel = selectChecks({ exclude: ["b"] });
    expect(sel.selected.map((c) => c.id)).toEqual(["a", "c"]);
  });

  test("selectChecks reports unknown ids without failing", () => {
    registerCheck(fakeCheck("a"));
    const sel = selectChecks({ include: ["a", "ghost"] });
    expect(sel.selected.map((c) => c.id)).toEqual(["a"]);
    expect(sel.unknown).toContain("ghost");
  });

  test("include + exclude composes (include then exclude)", () => {
    registerCheck(fakeCheck("a"));
    registerCheck(fakeCheck("b"));
    registerCheck(fakeCheck("c"));
    const sel = selectChecks({ include: ["a", "b", "c"], exclude: ["b"] });
    expect(sel.selected.map((c) => c.id)).toEqual(["a", "c"]);
  });
});
