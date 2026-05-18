import { describe, it, expect } from "bun:test";
import { resolveBudget, isBudget, BUDGETS } from "../../../src/core/checks/budget.ts";

describe("resolveBudget", () => {
  it("omitted budget returns legacy uncapped (no maxRequests, no stateful skip)", () => {
    expect(resolveBudget(undefined, undefined)).toEqual({ skipStateful: false });
  });

  it("quick caps at 50 and skips stateful", () => {
    expect(resolveBudget("quick", undefined)).toEqual({ maxRequests: 50, skipStateful: true });
  });

  it("standard caps at 500 and keeps stateful", () => {
    expect(resolveBudget("standard", undefined)).toEqual({
      maxRequests: 500,
      skipStateful: false,
    });
  });

  it("full leaves cap unset and keeps stateful", () => {
    expect(resolveBudget("full", undefined)).toEqual({ skipStateful: false });
  });

  it("--max-requests override wins over a tighter tier cap", () => {
    expect(resolveBudget("quick", 200)).toEqual({ maxRequests: 200, skipStateful: true });
  });

  it("--max-requests override wins even when tier is uncapped", () => {
    expect(resolveBudget("full", 30)).toEqual({ maxRequests: 30, skipStateful: false });
  });

  it("zero or negative --max-requests is ignored, tier cap survives", () => {
    expect(resolveBudget("quick", 0)).toEqual({ maxRequests: 50, skipStateful: true });
    expect(resolveBudget("quick", -1)).toEqual({ maxRequests: 50, skipStateful: true });
  });

  it("forceStatefulIfIncluded opts back into stateful checks under quick", () => {
    expect(resolveBudget("quick", undefined, { forceStatefulIfIncluded: true })).toEqual({
      maxRequests: 50,
      skipStateful: false,
    });
  });
});

describe("isBudget", () => {
  it("accepts the three tier names", () => {
    expect(BUDGETS).toEqual(["quick", "standard", "full"]);
    for (const b of BUDGETS) expect(isBudget(b)).toBe(true);
  });

  it("rejects unrelated strings and non-strings", () => {
    expect(isBudget("medium")).toBe(false);
    expect(isBudget("")).toBe(false);
    expect(isBudget(undefined)).toBe(false);
    expect(isBudget(50)).toBe(false);
  });
});
