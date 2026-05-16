/**
 * ARV-123 (m-19): registry contract — register, dedup-by-id, scope
 * filter, and `applyAntiFp` end-to-end behaviour.
 */
import { describe, test, expect, beforeEach } from "bun:test";

import {
  applyAntiFp,
  get,
  list,
  register,
  reset,
  type FpRule,
} from "../../../src/core/anti-fp/index.ts";

interface DummyCtx {
  field: string;
}

const RULE_A: FpRule<DummyCtx> = {
  id: "rule_a_form_drop",
  scope: "check:negative_data_rejection",
  applies: ctx => (ctx.field === "drop" ? { ruleId: "", scope: "", reason: "form-drop fires" } : null),
  references: ["#2482"],
};

const RULE_B: FpRule<DummyCtx> = {
  id: "rule_b_probe_baseline",
  scope: ["probe:security", "probe:mass-assignment"],
  applies: ctx => (ctx.field === "baseline" ? { ruleId: "", scope: "", reason: "baseline echo" } : null),
};

describe("anti-fp registry — register / get / list", () => {
  beforeEach(() => reset());

  test("register makes the rule discoverable via get", () => {
    register(RULE_A);
    expect(get("rule_a_form_drop")?.id).toBe("rule_a_form_drop");
  });

  test("re-registering the same id replaces the prior rule (last-writer wins)", () => {
    register(RULE_A);
    const replacement: FpRule<DummyCtx> = { ...RULE_A, reason: "swapped" };
    register(replacement);
    expect(get("rule_a_form_drop")?.reason).toBe("swapped");
    // No silent duplicate.
    expect(list().length).toBe(1);
  });

  test("list() returns all rules when no scope is given", () => {
    register(RULE_A);
    register(RULE_B);
    expect(list().map(r => r.id).sort()).toEqual(["rule_a_form_drop", "rule_b_probe_baseline"]);
  });

  test("list(scope) filters by single-scope rules", () => {
    register(RULE_A);
    register(RULE_B);
    const subset = list("check:negative_data_rejection");
    expect(subset.map(r => r.id)).toEqual(["rule_a_form_drop"]);
  });

  test("list(scope) matches array-scope rules", () => {
    register(RULE_B);
    expect(list("probe:security").map(r => r.id)).toEqual(["rule_b_probe_baseline"]);
    expect(list("probe:mass-assignment").map(r => r.id)).toEqual(["rule_b_probe_baseline"]);
    expect(list("check:negative_data_rejection")).toEqual([]);
  });
});

describe("applyAntiFp — end-to-end suppression assembly", () => {
  beforeEach(() => reset());

  test("first rule that fires wins; later rules are not consulted", () => {
    let bCalls = 0;
    register({
      ...RULE_A,
      applies: () => ({ ruleId: "", scope: "", reason: "A claims it" }),
    });
    register({
      ...RULE_B,
      scope: "check:negative_data_rejection",
      applies: () => {
        bCalls++;
        return { ruleId: "", scope: "", reason: "B" };
      },
    });

    const s = applyAntiFp<DummyCtx>({ field: "x" }, "check:negative_data_rejection");
    expect(s?.ruleId).toBe("rule_a_form_drop");
    expect(s?.reason).toBe("A claims it");
    expect(bCalls).toBe(0);
  });

  test("suppression carries the resolved scope and rule references", () => {
    register(RULE_A);
    const s = applyAntiFp<DummyCtx>({ field: "drop" }, "check:negative_data_rejection");
    expect(s).toEqual({
      ruleId: "rule_a_form_drop",
      scope: "check:negative_data_rejection",
      reason: "form-drop fires",
      references: ["#2482"],
    });
  });

  test("no matching rule → null (no suppression)", () => {
    register(RULE_A);
    expect(applyAntiFp<DummyCtx>({ field: "noop" }, "check:negative_data_rejection")).toBeNull();
  });

  test("rule whose scope doesn't include the caller's scope is skipped even when applies() would fire", () => {
    register(RULE_A); // declared scope: check:negative_data_rejection
    const s = applyAntiFp<DummyCtx>({ field: "drop" }, "probe:security");
    expect(s).toBeNull();
  });

  test("rule's runtime reason wins over the static fallback", () => {
    register({
      id: "static_reason",
      scope: "check:x",
      reason: "static",
      applies: () => ({ ruleId: "", scope: "", reason: "runtime" }),
    });
    expect(applyAntiFp({}, "check:x")?.reason).toBe("runtime");
  });
});
