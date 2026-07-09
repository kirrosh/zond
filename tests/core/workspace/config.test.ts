import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadWorkspaceDefaults,
  resolveTimeoutMs,
  resolveRateLimit,
  HARD_DEFAULT_TIMEOUT_MS,
  _resetWorkspaceConfigCache,
} from "../../../src/core/workspace/config.ts";
import { _resetWorkspaceWarning } from "../../../src/core/workspace/root.ts";

describe("workspace config (TASK-301)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zond-cfg-"));
    _resetWorkspaceConfigCache();
    _resetWorkspaceWarning();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    _resetWorkspaceConfigCache();
  });

  function writeConfig(body: string): void {
    writeFileSync(join(root, "zond.config.yml"), body);
  }

  test("returns empty defaults when no marker is present", () => {
    // No marker → fromFallback path → {}.
    const fallback = mkdtempSync(join(tmpdir(), "zond-no-marker-"));
    try {
      expect(loadWorkspaceDefaults(fallback)).toEqual({});
    } finally {
      rmSync(fallback, { recursive: true, force: true });
    }
  });

  test("parses defaults.timeout_ms and defaults.rate_limit", () => {
    writeConfig("defaults:\n  timeout_ms: 5000\n  rate_limit: 3\n");
    expect(loadWorkspaceDefaults(root)).toEqual({ timeoutMs: 5000, rateLimit: 3 });
  });

  test("accepts camelCase aliases (timeoutMs / rateLimit)", () => {
    writeConfig("defaults:\n  timeoutMs: 7500\n  rateLimit: auto\n");
    expect(loadWorkspaceDefaults(root)).toEqual({ timeoutMs: 7500, rateLimit: "auto" });
  });

  test("ignores non-positive or malformed values", () => {
    writeConfig("defaults:\n  timeout_ms: -1\n  rate_limit: not-a-number\n");
    expect(loadWorkspaceDefaults(root)).toEqual({});
  });

  test("resolveTimeoutMs: CLI > env meta > workspace > 30000", () => {
    writeConfig("defaults:\n  timeout_ms: 9000\n");
    expect(resolveTimeoutMs(1234, 5000, root)).toBe(1234);   // CLI wins
    expect(resolveTimeoutMs(undefined, 5000, root)).toBe(5000); // env wins
    expect(resolveTimeoutMs(undefined, undefined, root)).toBe(9000); // workspace
    _resetWorkspaceConfigCache();
    rmSync(join(root, "zond.config.yml"));
    mkdirSync(join(root, ".zond")); // keep workspace marker; no config
    expect(resolveTimeoutMs(undefined, undefined, root)).toBe(HARD_DEFAULT_TIMEOUT_MS);
  });

  test("resolveRateLimit: CLI > env meta > workspace > undefined", () => {
    writeConfig("defaults:\n  rate_limit: 4\n");
    expect(resolveRateLimit("auto", 2, root)).toBe("auto");   // CLI wins
    expect(resolveRateLimit(undefined, 2, root)).toBe(2);     // env wins
    expect(resolveRateLimit(undefined, undefined, root)).toBe(4); // workspace
    _resetWorkspaceConfigCache();
    rmSync(join(root, "zond.config.yml"));
    mkdirSync(join(root, ".zond"));
    expect(resolveRateLimit(undefined, undefined, root)).toBeUndefined();
  });
});
