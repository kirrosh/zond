import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CANONICAL_IDENTITY_KEYS,
  loadIdentityFile,
  resolveIdentityRefs,
} from "../../../src/core/identity/identity-file.ts";
import { SecretRegistry, setSecretRegistry } from "../../../src/core/secrets/registry.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zond-identity-"));
  setSecretRegistry(new SecretRegistry());
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadIdentityFile (TASK-174)", () => {
  test("returns null when missing", () => {
    expect(loadIdentityFile(dir)).toBeNull();
  });

  test("does NOT register values with the SecretRegistry", () => {
    writeFileSync(
      join(dir, ".identity.yaml"),
      'organization_id_or_slug: "acme-eng"\nmember_id: "12345"\n',
    );
    const out = loadIdentityFile(dir)!;
    expect(out.values.organization_id_or_slug).toBe("acme-eng");
    // Identity != secret. The redaction registry should remain empty.
    const reg = new SecretRegistry();
    setSecretRegistry(reg);
    loadIdentityFile(dir);
    expect(reg.redactedNames()).toEqual([]);
  });

  test("rejects nested values", () => {
    writeFileSync(join(dir, ".identity.yaml"), "creds:\n  org: a\n");
    expect(() => loadIdentityFile(dir)).toThrow(/nested values are not supported/);
  });
});

describe("resolveIdentityRefs (TASK-174)", () => {
  test("substitutes @identity:<name>", () => {
    const id = { filePath: "/.identity.yaml", values: { organization_id_or_slug: "acme" } };
    const out = resolveIdentityRefs(
      { organization_id_or_slug: "@identity:organization_id_or_slug", base_url: "x" },
      id,
      "/.env.yaml",
    );
    expect(out.organization_id_or_slug).toBe("acme");
    expect(out.base_url).toBe("x");
  });

  test("missing @identity: reference fails loud", () => {
    expect(() =>
      resolveIdentityRefs(
        { org: "@identity:organization_id_or_slug" },
        { filePath: "/.identity.yaml", values: {} },
        "/.env.yaml",
      ),
    ).toThrow(/@identity:organization_id_or_slug/);
  });
});

describe("canonical identity vocabulary", () => {
  test("includes the common Sentry-style keys", () => {
    expect(CANONICAL_IDENTITY_KEYS.has("organization_id_or_slug")).toBe(true);
    expect(CANONICAL_IDENTITY_KEYS.has("project_id_or_slug")).toBe(true);
    expect(CANONICAL_IDENTITY_KEYS.has("member_id")).toBe(true);
    expect(CANONICAL_IDENTITY_KEYS.has("team_slug")).toBe(true);
  });
});
