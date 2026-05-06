import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rotateOutputTarget } from "../../../src/core/workspace/output-rotation.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zond-rotate-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("rotateOutputTarget (TASK-162)", () => {
  test("no-op when target does not exist", () => {
    const target = join(dir, "digest.md");
    const r = rotateOutputTarget(target);
    expect(r.rotatedFrom).toBeUndefined();
    expect(r.rotatedTo).toBeUndefined();
    expect(existsSync(target)).toBe(false);
  });

  test("renames existing target to -v2 on first rotation", () => {
    const target = join(dir, "digest.md");
    writeFileSync(target, "v1");
    const r = rotateOutputTarget(target);
    expect(r.rotatedTo).toBe(join(dir, "digest-v2.md"));
    expect(readFileSync(r.rotatedTo!, "utf-8")).toBe("v1");
    expect(existsSync(target)).toBe(false);
  });

  test("picks the next free -vN slot", () => {
    const target = join(dir, "digest.md");
    writeFileSync(target, "v1");
    writeFileSync(join(dir, "digest-v2.md"), "old-v2");
    writeFileSync(join(dir, "digest-v3.md"), "old-v3");
    const r = rotateOutputTarget(target);
    expect(r.rotatedTo).toBe(join(dir, "digest-v4.md"));
    expect(readFileSync(r.rotatedTo!, "utf-8")).toBe("v1");
  });

  test("--overwrite skips rotation entirely", () => {
    const target = join(dir, "digest.md");
    writeFileSync(target, "v1");
    const r = rotateOutputTarget(target, { overwrite: true });
    expect(r.rotatedTo).toBeUndefined();
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("v1");
  });

  test("strips an existing -vN suffix from the stem before rotating", () => {
    // If a user passes `--output digest-v2.md` and that file already exists,
    // we should rotate it to digest-v3.md, not digest-v2-v2.md.
    const target = join(dir, "digest-v2.md");
    writeFileSync(target, "v1");
    const r = rotateOutputTarget(target);
    expect(r.rotatedTo).toBe(join(dir, "digest-v3.md"));
  });

  test("notice callback is invoked once on rotation", () => {
    const target = join(dir, "x.md");
    writeFileSync(target, "v1");
    let received: string | undefined;
    rotateOutputTarget(target, { notice: (m) => { received = m; } });
    expect(received).toMatch(/Previous artifact moved to .*x-v2\.md$/);
  });
});
