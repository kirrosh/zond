/**
 * ARV-377 — `zond secrets set`: Bearer-strip normalisation + the
 * upsert/backup write against a tmp `.secrets.yaml`.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSecretValue, applySecretWrite } from "../../src/cli/commands/secrets.ts";

describe("normalizeSecretValue (ARV-377)", () => {
  test("strips a leading 'Bearer ' prefix (case-insensitive)", () => {
    expect(normalizeSecretValue("Bearer eyJabc")).toEqual({ value: "eyJabc", bearerStripped: true });
    expect(normalizeSecretValue("bearer   tok_1")).toEqual({ value: "tok_1", bearerStripped: true });
  });
  test("leaves a raw token untouched", () => {
    expect(normalizeSecretValue("eyJabc")).toEqual({ value: "eyJabc", bearerStripped: false });
  });
  test("--literal keeps the Bearer prefix verbatim", () => {
    expect(normalizeSecretValue("Bearer eyJabc", true)).toEqual({ value: "Bearer eyJabc", bearerStripped: false });
  });
});

describe("applySecretWrite (ARV-377)", () => {
  test("creates the file (no backup) then upserts + backs up on second write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zond-secrets-"));
    const path = join(dir, ".secrets.yaml");

    const first = await applySecretWrite(path, "auth_token", "tok_1");
    expect(first.backup).toBeNull();
    expect(readFileSync(path, "utf-8")).toContain('auth_token: "tok_1"');

    const second = await applySecretWrite(path, "auth_token", "tok_2");
    expect(second.backup).toBe(`${path}.bak`);
    expect(existsSync(`${path}.bak`)).toBe(true);
    // in-place upsert, not a duplicate line
    const text = readFileSync(path, "utf-8");
    expect(text).toContain('auth_token: "tok_2"');
    expect(text.match(/auth_token:/g)?.length).toBe(1);
  });

  test("preserves existing unrelated keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zond-secrets-"));
    const path = join(dir, ".secrets.yaml");
    writeFileSync(path, 'dsn: "https://x"\n', "utf-8");
    await applySecretWrite(path, "auth_token", "tok");
    const text = readFileSync(path, "utf-8");
    expect(text).toContain('dsn: "https://x"');
    expect(text).toContain('auth_token: "tok"');
  });
});
