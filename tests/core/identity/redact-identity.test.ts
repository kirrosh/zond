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

  // ARV-221: home-directory path segments must be preserved verbatim —
  // the user/org name in `/Users/<name>/` is a local artifact, not
  // identity material the redactor should ship-strip.
  test("ARV-221: preserves /Users/<name>/ even when name matches an identity value", () => {
    const out = redactIdentityIn(
      "see /Users/kirrotech/foo/bar for the digest",
      { org: "kirrotech" },
    );
    expect(out).toBe("see /Users/kirrotech/foo/bar for the digest");
  });

  test("ARV-221: preserves /home/<name>/ on Linux", () => {
    const out = redactIdentityIn(
      "path: /home/kirrotech/data",
      { org: "kirrotech" },
    );
    expect(out).toBe("path: /home/kirrotech/data");
  });

  test("ARV-221: preserves C:\\Users\\<name>\\ on Windows", () => {
    const out = redactIdentityIn(
      "C:\\Users\\kirrotech\\data",
      { org: "kirrotech" },
    );
    expect(out).toBe("C:\\Users\\kirrotech\\data");
  });

  test("ARV-221: still redacts identity references OUTSIDE home-dir paths", () => {
    // Mixed: org=kirrotech appears both as a real reference and inside
    // a /Users/ path. Only the standalone reference should be redacted.
    const out = redactIdentityIn(
      "owner: kirrotech, see /Users/kirrotech/x",
      { org: "kirrotech" },
    );
    expect(out).toBe("owner: <identity:org>, see /Users/kirrotech/x");
  });
});
