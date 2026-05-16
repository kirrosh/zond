/**
 * ARV-43: `zond session list` surfaces session_ids from the runs table so
 * users can pass them to `zond coverage --union session --session-id <id>`
 * without dropping into sqlite.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionListCommand } from "../../src/cli/commands/session.ts";
import { closeDb, getDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun } from "../../src/db/queries/runs.ts";
import { captureOutput } from "../_helpers/output";

describe("ARV-43: zond session list", () => {
  let workDir: string;
  let savedCwd: string;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "zond-session-list-"));
    writeFileSync(join(workDir, "zond.config.yml"), "version: 1\n", "utf-8");
    savedCwd = process.cwd();
    process.chdir(workDir);
    getDb();
    suppress = captureOutput();
  });

  afterEach(() => {
    suppress.restore();
    process.chdir(savedCwd);
    closeDb();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("empty DB: prints helpful empty-state message + exit 0", async () => {
    const code = await sessionListCommand({});
    expect(code).toBe(0);
    expect(suppress.out).toMatch(/No sessions recorded yet/);
  });

  test("lists distinct sessions with run counts", async () => {
    const sid1 = "11111111-2222-3333-4444-555555555555";
    const sid2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const r1 = createRun({ started_at: "2026-05-10T12:00:00Z", session_id: sid1 });
    const r2 = createRun({ started_at: "2026-05-10T12:05:00Z", session_id: sid1 });
    const r3 = createRun({ started_at: "2026-05-10T12:10:00Z", session_id: sid2 });
    finalizeRun(r1, [{ total: 5, passed: 4, failed: 1, skipped: 0, started_at: "2026-05-10T12:00:00Z", finished_at: "2026-05-10T12:00:30Z" } as never]);
    finalizeRun(r2, [{ total: 3, passed: 3, failed: 0, skipped: 0, started_at: "2026-05-10T12:05:00Z", finished_at: "2026-05-10T12:05:10Z" } as never]);
    finalizeRun(r3, [{ total: 1, passed: 0, failed: 1, skipped: 0, started_at: "2026-05-10T12:10:00Z", finished_at: "2026-05-10T12:10:05Z" } as never]);

    const code = await sessionListCommand({});
    expect(code).toBe(0);
    expect(suppress.out).toContain(sid1);
    expect(suppress.out).toContain(sid2);
    expect(suppress.out).toMatch(/Showing 2 of 2 session/);
    // sid1 has 2 runs (5+3 total, 4+3 pass, 1+0 fail)
    expect(suppress.out).toMatch(new RegExp(`${sid1}.*7/1/0`));
  });

  test("--json envelope returns sessions array", async () => {
    const sid = "00000000-0000-0000-0000-000000000001";
    const r = createRun({ started_at: "2026-05-10T13:00:00Z", session_id: sid });
    finalizeRun(r, [{ total: 2, passed: 2, failed: 0, skipped: 0, started_at: "2026-05-10T13:00:00Z", finished_at: "2026-05-10T13:00:01Z" } as never]);

    const code = await sessionListCommand({ json: true });
    expect(code).toBe(0);
    const env = JSON.parse(suppress.out);
    expect(env.ok).toBe(true);
    expect(env.command).toBe("session");
    expect(env.data.action).toBe("list");
    expect(env.data.total).toBe(1);
    expect(env.data.sessions).toHaveLength(1);
    expect(env.data.sessions[0].session_id).toBe(sid);
    expect(env.data.sessions[0].run_count).toBe(1);
  });
});
