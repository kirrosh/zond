/**
 * ARV-125: pin the migrated paid-plan-403 rule. The pattern set
 * regression-tests previously in tests/core/probe/mass-assignment-probe.test.ts
 * (the isSubscriptionGated batch) is still there via the re-export
 * shim; this file pins the *rule contract* — that it fires only at
 * 403, never on empty messages, and surfaces the wontfix reason.
 */
import { describe, test, expect } from "bun:test";
import { PAID_PLAN_403_RULE } from "../../../src/core/anti-fp/rules/subscription-gated/paid-plan-403.ts";
import { applyAntiFp } from "../../../src/core/anti-fp/index.ts";
import { bootstrapAntiFp, resetAntiFpBootstrap } from "../../../src/core/anti-fp/bootstrap.ts";

describe("subscription-gated/paid-plan-403 (ARV-125)", () => {
  test("rule metadata is wired", () => {
    expect(PAID_PLAN_403_RULE.id).toBe("subscription-gated/paid-plan-403");
    const scope = Array.isArray(PAID_PLAN_403_RULE.scope)
      ? PAID_PLAN_403_RULE.scope
      : [PAID_PLAN_403_RULE.scope];
    expect(scope).toContain("probe:mass-assignment");
    expect(PAID_PLAN_403_RULE.references).toContain("ARV-104");
  });

  test("fires on a paid-plan 403 body", () => {
    const sup = PAID_PLAN_403_RULE.applies({
      status: 403,
      message: "A paid plan is required to enable this feature.",
    });
    expect(sup).not.toBeNull();
    expect(sup!.reason).toMatch(/subscription-gated/);
    expect(sup!.reason).toMatch(/wontfix/);
  });

  test("does not fire on non-403", () => {
    expect(
      PAID_PLAN_403_RULE.applies({ status: 401, message: "A paid plan is required" }),
    ).toBeNull();
  });

  test("does not fire when message is undefined", () => {
    expect(PAID_PLAN_403_RULE.applies({ status: 403 })).toBeNull();
  });

  test("does not fire on a generic 403", () => {
    expect(
      PAID_PLAN_403_RULE.applies({ status: 403, message: "Forbidden" }),
    ).toBeNull();
  });

  test("registered via bootstrap and reachable through applyAntiFp", () => {
    resetAntiFpBootstrap();
    bootstrapAntiFp();
    const sup = applyAntiFp(
      { status: 403, message: "Requires the org:admin scope" },
      "probe:mass-assignment",
    );
    expect(sup).not.toBeNull();
    expect(sup!.ruleId).toBe("subscription-gated/paid-plan-403");
  });
});
