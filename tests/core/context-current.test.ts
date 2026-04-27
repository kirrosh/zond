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
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "zond-current-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  test("read returns null when .zond-current is missing", () => {
    expect(readCurrentApi(cwd)).toBeNull();
  });

  test("write then read roundtrip preserves the name", () => {
    const path = writeCurrentApi("petstore", cwd);
    expect(path).toBe(join(cwd, ".zond-current"));
    expect(readCurrentApi(cwd)).toBe("petstore");
    expect(readFileSync(path, "utf-8")).toBe("petstore\n");
  });

  test("write trims whitespace and rejects empty", () => {
    writeCurrentApi("  petstore  ", cwd);
    expect(readCurrentApi(cwd)).toBe("petstore");
    expect(() => writeCurrentApi("   ", cwd)).toThrow(/empty/);
  });

  test("read returns null for an empty/whitespace-only file", () => {
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
