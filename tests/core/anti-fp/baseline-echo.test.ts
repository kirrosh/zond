/**
 * ARV-126: baseline-echo rule unit pin.
 */
import { describe, test, expect } from "bun:test";
import { BASELINE_ECHO_RULE } from "../../../src/core/anti-fp/rules/baseline-echo.ts";
import { applyAntiFp } from "../../../src/core/anti-fp/index.ts";
import {
  bootstrapAntiFp,
  resetAntiFpBootstrap,
} from "../../../src/core/anti-fp/bootstrap.ts";

describe("baseline-echo (ARV-126)", () => {
  test("rule metadata", () => {
    expect(BASELINE_ECHO_RULE.id).toBe("baseline-echo");
    expect(BASELINE_ECHO_RULE.scope).toBe("probe:security");
  });

  test("fires when responseBody deeply equals baselineBody", () => {
    const body = { id: 1, status: "ok", tags: ["a", "b"] };
    const sup = BASELINE_ECHO_RULE.applies({
      responseBody: { ...body, tags: [...body.tags] },
      baselineBody: body,
    });
    expect(sup).not.toBeNull();
    expect(sup!.reason).toMatch(/ignored the attack payload/);
  });

  test("does not fire when bodies differ", () => {
    expect(
      BASELINE_ECHO_RULE.applies({
        responseBody: { id: 1, status: "ok" },
        baselineBody: { id: 1, status: "changed" },
      }),
    ).toBeNull();
  });

  test("does not fire when baseline is undefined (fail-open)", () => {
    expect(
      BASELINE_ECHO_RULE.applies({
        responseBody: { id: 1 },
        baselineBody: undefined,
      }),
    ).toBeNull();
  });

  test("nested arrays / objects compared deeply", () => {
    const a = { nested: { list: [1, { k: "v" }] } };
    const b = { nested: { list: [1, { k: "v" }] } };
    const sup = BASELINE_ECHO_RULE.applies({ responseBody: a, baselineBody: b });
    expect(sup).not.toBeNull();
  });

  test("array length mismatch counts as different", () => {
    expect(
      BASELINE_ECHO_RULE.applies({
        responseBody: [1, 2],
        baselineBody: [1, 2, 3],
      }),
    ).toBeNull();
  });

  test("registered via bootstrap and reachable through applyAntiFp", () => {
    resetAntiFpBootstrap();
    bootstrapAntiFp();
    const sup = applyAntiFp(
      { responseBody: { x: 1 }, baselineBody: { x: 1 } },
      "probe:security",
    );
    expect(sup?.ruleId).toBe("baseline-echo");
  });
});
