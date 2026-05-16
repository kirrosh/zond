import { describe, expect, test } from "bun:test";
import { redactIdentityIn } from "../../../src/core/identity/identity-file.ts";

describe("redactIdentityIn (TASK-173)", () => {
  test("replaces every value with <identity:<key>>", () => {
    const out = redactIdentityIn(
      "org=acme-eng project=hello-world",
      { organization_id_or_slug: "acme-eng", project_id_or_slug: "hello-world" },
    );
    expect(out).toBe("org=<identity:organization_id_or_slug> project=<identity:project_id_or_slug>");
  });

  test("ignores values shorter than 2 characters", () => {
    const out = redactIdentityIn("id=1 here", { account_id: "1" });
    expect(out).toBe("id=1 here");
  });

  test("longest values redact first (specificity)", () => {
    const out = redactIdentityIn(
      "/orgs/acme-eng-prod/projects",
      { org_short: "acme", org_full: "acme-eng-prod" },
    );
    expect(out).toContain("<identity:org_full>");
    expect(out).not.toContain("acme-eng-prod");
  });

  test("noop on empty inputs", () => {
    expect(redactIdentityIn("", { x: "y" })).toBe("");
    expect(redactIdentityIn("hello", {})).toBe("hello");
  });
});
