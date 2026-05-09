import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  clearCurrentApi,
  currentApiPath,
  readCurrentApi,
  writeCurrentApi,
} from "../../src/core/context/current.ts";

describe("context/current", () => {
  let cwd: string;
  // TASK-290: clear ZOND_API* envs so the env-first lookup branch doesn't
  // mask the file-based assertions in this suite.
  let savedEnv: { global?: string; api?: string };
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "zond-current-"));
    savedEnv = { global: process.env.ZOND_API_GLOBAL, api: process.env.ZOND_API };
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
    if (savedEnv.global !== undefined) process.env.ZOND_API_GLOBAL = savedEnv.global;
    if (savedEnv.api !== undefined) process.env.ZOND_API = savedEnv.api;
  });

  test("read returns null when .zond/current-api is missing", () => {
    expect(readCurrentApi(cwd)).toBeNull();
  });

  test("write then read roundtrip preserves the name", () => {
    const path = writeCurrentApi("petstore", cwd);
    expect(path).toBe(join(cwd, ".zond/current-api"));
    expect(readCurrentApi(cwd)).toBe("petstore");
    expect(readFileSync(path, "utf-8")).toBe("petstore\n");
  });

  test("ZOND_API_GLOBAL env wins over file (TASK-290)", () => {
    writeCurrentApi("from-file", cwd);
    process.env.ZOND_API_GLOBAL = "from-global-flag";
    expect(readCurrentApi(cwd)).toBe("from-global-flag");
  });

  test("ZOND_API env wins over file but not over ZOND_API_GLOBAL (TASK-290)", () => {
    writeCurrentApi("from-file", cwd);
    process.env.ZOND_API = "from-env";
    expect(readCurrentApi(cwd)).toBe("from-env");
    process.env.ZOND_API_GLOBAL = "from-global-flag";
    expect(readCurrentApi(cwd)).toBe("from-global-flag");
  });

  test("write trims whitespace and rejects empty", () => {
    writeCurrentApi("  petstore  ", cwd);
    expect(readCurrentApi(cwd)).toBe("petstore");
    expect(() => writeCurrentApi("   ", cwd)).toThrow(/empty/);
  });

  test("read returns null for an empty/whitespace-only file", () => {
    // currentApiPath now lives in .zond/, so create the dir first.
    require("fs").mkdirSync(join(cwd, ".zond"), { recursive: true });
    writeFileSync(currentApiPath(cwd), "   \n", "utf-8");
    expect(readCurrentApi(cwd)).toBeNull();
  });

  test("clear removes the file and returns true; returns false when nothing to remove", () => {
    writeCurrentApi("petstore", cwd);
    expect(clearCurrentApi(cwd)).toBe(true);
    expect(existsSync(currentApiPath(cwd))).toBe(false);
    expect(clearCurrentApi(cwd)).toBe(false);
  });
});
