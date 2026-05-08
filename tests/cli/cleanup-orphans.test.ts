import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cleanupCommand } from "../../src/cli/commands/cleanup.ts";
import { appendOrphanRecord, loadOrphans } from "../../src/core/probe/orphan-tracker.ts";
import { captureOutput } from "../_helpers/output";
import { mockFetchRouter, restoreFetch } from "../_helpers/fetch-mock";

// TASK-278: orphan tracker + `zond cleanup --orphans`. Live probe-runtime
// integration is exercised in probe-security tests; here we focus on the
// orphan-store + cleanup CLI: recording, dedup, dry-run, retry, 404-as-success.

describe("orphan-tracker + zond cleanup --orphans (TASK-278)", () => {
  let dir: string;
  let suppress: ReturnType<typeof captureOutput>;
  let fetchHandle: ReturnType<typeof mockFetchRouter>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "zond-orphans-"));
    process.env.ZOND_ORPHANS_DIR = dir;
    suppress = captureOutput({ console: true });
  });

  afterEach(() => {
    delete process.env.ZOND_ORPHANS_DIR;
    suppress.restore();
    fetchHandle?.restore();
    restoreFetch();
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadOrphans collapses removed-supersessions and dedupes", async () => {
    const base = {
      api: "demo",
      runId: "1",
      createdAt: new Date().toISOString(),
      method: "POST",
      path: "/teams/",
      lastCleanupError: null,
    };
    await appendOrphanRecord({ ...base, id: "a", deletePath: "/teams/a", lastCleanupStatus: 500 });
    await appendOrphanRecord({ ...base, id: "b", deletePath: "/teams/b", lastCleanupStatus: 503 });
    // Supersede 'a' as removed.
    await appendOrphanRecord({ ...base, id: "a", deletePath: "/teams/a", lastCleanupStatus: 200, removed: true });

    const survivors = await loadOrphans();
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toMatchObject({ id: "b", deletePath: "/teams/b" });
  });

  test("--orphans --dry-run prints plan without sending HTTP", async () => {
    let callCount = 0;
    fetchHandle = mockFetchRouter(() => {
      callCount++;
      return { status: 204 };
    });

    await appendOrphanRecord({
      api: "demo", runId: "1", createdAt: new Date().toISOString(),
      method: "POST", path: "/teams/", id: "x", deletePath: "/teams/x",
      lastCleanupStatus: 500, lastCleanupError: null,
    });

    const code = await cleanupCommand({ orphans: true, dryRun: true, baseUrl: "http://srv", json: false });
    expect(code).toBe(0);
    expect(callCount).toBe(0);
    expect(suppress.out).toMatch(/Dry-run: 1 orphan/);
  });

  test("retry: 2xx removes the orphan; 404 is treated as success", async () => {
    const seen: string[] = [];
    fetchHandle = mockFetchRouter((call) => {
      seen.push(`${call.method} ${call.url}`);
      if (call.url.endsWith("/teams/gone")) return { status: 404 };
      if (call.url.endsWith("/teams/cleaned")) return { status: 204 };
      return { status: 500 };
    });

    const t = new Date().toISOString();
    await appendOrphanRecord({ api: "demo", runId: "1", createdAt: t, method: "POST", path: "/teams/", id: "gone",    deletePath: "/teams/gone",    lastCleanupStatus: 500, lastCleanupError: null });
    await appendOrphanRecord({ api: "demo", runId: "1", createdAt: t, method: "POST", path: "/teams/", id: "cleaned", deletePath: "/teams/cleaned", lastCleanupStatus: 500, lastCleanupError: null });
    await appendOrphanRecord({ api: "demo", runId: "1", createdAt: t, method: "POST", path: "/teams/", id: "alive",   deletePath: "/teams/alive",   lastCleanupStatus: 500, lastCleanupError: null });

    const code = await cleanupCommand({ orphans: true, baseUrl: "http://srv", json: false });
    expect(code).toBe(1); // one still alive

    expect(seen).toHaveLength(3);
    expect(seen.every(s => s.startsWith("DELETE "))).toBe(true);

    const survivors = await loadOrphans();
    // Only "alive" should remain.
    expect(survivors.map(s => s.id).sort()).toEqual(["alive"]);
  });

  test("--orphans without records exits 0 with empty plan", async () => {
    const code = await cleanupCommand({ orphans: true, baseUrl: "http://srv", json: false });
    expect(code).toBe(0);
    expect(suppress.out).toMatch(/No orphan resources to retry/);
  });

  test("missing --orphans flag → usage error", async () => {
    const code = await cleanupCommand({ orphans: false, json: false });
    expect(code).toBe(2);
    expect(suppress.err).toMatch(/--orphans/);
  });
});
