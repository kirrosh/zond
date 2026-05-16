import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSecretsFile, resolveSecretRefs } from "../../../src/core/secrets/secrets-file.ts";
import { SecretRegistry, setSecretRegistry } from "../../../src/core/secrets/registry.ts";

let dir: string;
let reg: SecretRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zond-secrets-"));
  reg = new SecretRegistry();
  setSecretRegistry(reg);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  setSecretRegistry(new SecretRegistry());
});

describe("loadSecretsFile (TASK-170)", () => {
  test("returns null when file is absent", () => {
    expect(loadSecretsFile(dir)).toBeNull();
  });

  test("registers every value with the global registry", () => {
    writeFileSync(join(dir, ".secrets.yaml"), 'auth_token: "abcd1234efgh"\ndsn: "postgres://abcd1234efgh"\n');
    const out = loadSecretsFile(dir)!;
    expect(out.values.auth_token).toBe("abcd1234efgh");
    expect(reg.redactedNames().sort()).toEqual(["auth_token", "dsn"]);
  });

  test("rejects nested values with a clear error", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".secrets.yaml"), "creds:\n  user: a\n  pass: b\n");
    expect(() => loadSecretsFile(dir)).toThrow(/nested values are not supported/);
  });
});

describe("resolveSecretRefs (TASK-170)", () => {
  test("substitutes @secret:<name> with values from .secrets.yaml", () => {
    const secrets = { filePath: "/abs/.secrets.yaml", values: { auth_token: "abcd1234" } };
    const out = resolveSecretRefs(
      { auth_token: "@secret:auth_token", base_url: "https://x" },
      secrets,
      "/abs/.env.yaml",
    );
    expect(out.auth_token).toBe("abcd1234");
    expect(out.base_url).toBe("https://x");
  });

  test("missing @secret: reference throws with file/key context", () => {
    const secrets = { filePath: "/abs/.secrets.yaml", values: {} };
    expect(() =>
      resolveSecretRefs(
        { auth_token: "@secret:auth_token" },
        secrets,
        "/abs/.env.yaml",
      ),
    ).toThrow(/"auth_token" references @secret:auth_token.*\.secrets\.yaml/s);
  });

  test("plain values pass through unchanged", () => {
    const out = resolveSecretRefs(
      { base_url: "https://example.com" },
      null,
      "/abs/.env.yaml",
    );
    expect(out.base_url).toBe("https://example.com");
  });
});
