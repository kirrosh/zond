/**
 * Tests for `.zond/current-session` lifecycle and the run-time
 * resolution helper. Mirrors the contract used by `zond session` and
 * the `--session-id` resolution chain in `zond run`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCurrentSession,
  writeCurrentSession,
  clearCurrentSession,
  resolveSessionId,
  sessionFilePath,
} from "../../src/core/context/session.ts";

describe("context/session", () => {
  let workspace: string;
  let savedCwd: string;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-session-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    savedCwd = process.cwd();
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  test("read returns null when no session file", () => {
    expect(readCurrentSession()).toBeNull();
  });

  test("write then read roundtrip with label", () => {
    const path = writeCurrentSession({
      id: "11111111-1111-1111-1111-111111111111",
      label: "post-deploy",
      started_at: "2026-04-30T00:00:00Z",
    });
    expect(path).toBe(sessionFilePath());
    const got = readCurrentSession();
    expect(got).not.toBeNull();
    expect(got!.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(got!.label).toBe("post-deploy");
  });

  test("legacy single-line UUID file is still readable", async () => {
    const sid = "22222222-2222-2222-2222-222222222222";
    const path = sessionFilePath();
    const { mkdirSync: mk } = await import("node:fs");
    const { dirname } = await import("node:path");
    mk(dirname(path), { recursive: true });
    writeFileSync(path, sid + "\n", "utf-8");

    const got = readCurrentSession();
    expect(got).not.toBeNull();
    expect(got!.id).toBe(sid);
  });

  test("clear removes the session file", () => {
    writeCurrentSession({
      id: "33333333-3333-3333-3333-333333333333",
      started_at: "2026-04-30T00:00:00Z",
    });
    expect(clearCurrentSession()).toBe(true);
    expect(clearCurrentSession()).toBe(false); // idempotent
    expect(readCurrentSession()).toBeNull();
  });
});

describe("context/session / resolveSessionId precedence", () => {
  let workspace: string;
  let savedCwd: string;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-session-resolve-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    savedCwd = process.cwd();
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  test("flag wins over env wins over file", () => {
    writeCurrentSession({ id: "FILE-ID", started_at: "2026-04-30T00:00:00Z" });
    expect(resolveSessionId({ flag: "FLAG", env: "ENV" })).toBe("FLAG");
    expect(resolveSessionId({ flag: undefined, env: "ENV" })).toBe("ENV");
    expect(resolveSessionId({ flag: undefined, env: undefined })).toBe("FILE-ID");
  });

  test("returns null when nothing is set", () => {
    expect(resolveSessionId({ flag: undefined, env: undefined })).toBeNull();
  });

  test("ignores empty/whitespace-only flag and env", () => {
    writeCurrentSession({ id: "FILE-ID", started_at: "2026-04-30T00:00:00Z" });
    expect(resolveSessionId({ flag: "  ", env: "" })).toBe("FILE-ID");
  });
});
