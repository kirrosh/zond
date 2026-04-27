import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  WORKSPACE_MARKERS,
  findWorkspaceRoot,
  resolveWorkspacePath,
  _resetWorkspaceWarning,
} from "../../../src/core/workspace/root.ts";

describe("findWorkspaceRoot", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zond-ws-"));
    _resetWorkspaceWarning();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("detects each supported marker at the start directory", () => {
    for (const marker of WORKSPACE_MARKERS) {
      const dir = mkdtempSync(join(tmpdir(), "zond-ws-m-"));
      try {
        const path = join(dir, marker);
        if (marker === ".zond" || marker === "apis") mkdirSync(path);
        else writeFileSync(path, "");
        const info = findWorkspaceRoot(dir);
        expect(info.fromFallback).toBe(false);
        expect(info.marker).toBe(marker);
        expect(info.root).toBe(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("walks up from a subfolder to the marker", () => {
    writeFileSync(join(root, "zond.config.yml"), "");
    const sub = join(root, "deep", "nested");
    mkdirSync(sub, { recursive: true });

    const info = findWorkspaceRoot(sub);
    expect(info.root).toBe(root);
    expect(info.marker).toBe("zond.config.yml");
    expect(info.fromFallback).toBe(false);
  });

  test("returns fallback when no marker exists between start and HOME/root", () => {
    // /tmp is outside HOME — no marker → walk all the way up, fall back
    const info = findWorkspaceRoot(root);
    expect(info.fromFallback).toBe(true);
    expect(info.root).toBe(root);
    expect(info.marker).toBe("");
  });

  test("prefers earlier marker when multiple are present", () => {
    writeFileSync(join(root, "zond.config.yml"), "");
    writeFileSync(join(root, "zond.db"), "");
    mkdirSync(join(root, "apis"));
    const info = findWorkspaceRoot(root);
    expect(info.marker).toBe("zond.config.yml");
  });

  test("ignores file when marker is expected to be a directory and vice versa", () => {
    // A file named ".zond" should NOT count (we only accept directories)
    writeFileSync(join(root, ".zond"), "");
    const info = findWorkspaceRoot(root);
    expect(info.fromFallback).toBe(true);
  });

  test("resolveWorkspacePath joins relative onto detected root", () => {
    writeFileSync(join(root, "zond.config.yml"), "");
    const sub = join(root, "x");
    mkdirSync(sub);
    expect(resolveWorkspacePath("zond.db", sub)).toBe(join(root, "zond.db"));
  });
});
