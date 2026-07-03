/**
 * ARV-309: the dry-run digest must state explicitly that no traffic was sent,
 * so a plan can't be misread as a findings list ("ran, found nothing" vs
 * "never fired").
 */
import { describe, test, expect } from "bun:test";
import { formatDryRunDigest } from "../../../src/core/probe/dry-run-envelope.ts";
import type { EndpointPlan } from "../../../src/core/probe/types.ts";

const plan: EndpointPlan[] = [
  { method: "POST", path: "/users", planned: true, fields_planned: ["role"], classes_planned: ["privilege"] } as EndpointPlan,
];

describe("formatDryRunDigest (ARV-309)", () => {
  test("appends an explicit 'not executed' line", () => {
    const out = formatDryRunDigest(plan);
    expect(out).toContain("NOT executed");
    expect(out).toContain("--dry-run");
  });
});
