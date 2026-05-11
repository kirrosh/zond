import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cleanupCommand } from "../../src/cli/commands/cleanup.ts";
import { appendOrphanRecord, loadOrphans, persistVerdictsAsOrphans } from "../../src/core/probe/orphan-tracker.ts";
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

  // ARV-102 (F7): orphan records that the probe couldn't auto-clean
  // (no DELETE counterpart in spec, response had no usable id) are now
  // persisted with `requires_manual_cleanup: true`. cleanup --orphans
  // surfaces them in a dedicated "manual_cleanup_required" bucket and
  // exits 1 (CI must fail loudly when probes leak un-deletable state).
  test("requires_manual_cleanup records surface in dedicated bucket and force exit 1", async () => {
    let httpCalls = 0;
    fetchHandle = mockFetchRouter(() => {
      httpCalls++;
      return { status: 204 };
    });

    const t = new Date().toISOString();
    // Auto-cleanable orphan (will be retried via DELETE).
    await appendOrphanRecord({
      api: "demo", runId: "1", createdAt: t,
      method: "POST", path: "/teams/", id: "alive", deletePath: "/teams/alive",
      lastCleanupStatus: 500, lastCleanupError: null,
    });
    // Manual-only — no DELETE counterpart in spec.
    await appendOrphanRecord({
      api: "demo", runId: "1", createdAt: t,
      method: "POST", path: "/symbol-sources/", id: "src_1", deletePath: "",
      lastCleanupStatus: null, lastCleanupError: "no DELETE counterpart for POST /symbol-sources/",
      requires_manual_cleanup: true,
    });
    // Manual-only — response had no usable id, so id is empty too.
    await appendOrphanRecord({
      api: "demo", runId: "1", createdAt: t,
      method: "POST", path: "/api-keys/", id: "", deletePath: "",
      lastCleanupStatus: null, lastCleanupError: "cleanup skipped: response had no usable id",
      requires_manual_cleanup: true,
    });

    const code = await cleanupCommand({ orphans: true, baseUrl: "http://srv", json: false });
    expect(code).toBe(1); // manual-only entries push exit code to 1
    // DELETE was attempted only for the retriable record, not the manual-only ones.
    expect(httpCalls).toBe(1);
    expect(suppress.err).toMatch(/2 resource\(s\) need manual cleanup/);
    expect(suppress.err).toMatch(/symbol-sources/);
    expect(suppress.err).toMatch(/api-keys/);
  });

  // ARV-102 (F7): persistVerdictsAsOrphans must capture verdicts whose
  // probe-side cleanup attempt was *attempted* but had no usable id or
  // no DELETE counterpart. Pre-fix these were silently dropped, leaving
  // `cleanup --orphans` blind to them.
  test("persistVerdictsAsOrphans records cleanup-attempted-but-uncleanable verdicts", async () => {
    type LooseVerdict = Parameters<typeof persistVerdictsAsOrphans>[2][number];
    const verdicts: LooseVerdict[] = [
      // Standard cleanup-failed (has id + deletePath) → recorded as before.
      {
        method: "POST", path: "/teams/",
        cleanup: { attempted: true, id: "team_1", deletePath: "/teams/team_1", status: 500, error: null },
      } as unknown as LooseVerdict,
      // No DELETE counterpart in spec → manual_cleanup_required.
      {
        method: "POST", path: "/symbol-sources/",
        cleanup: { attempted: true, id: "src_1", deletePath: "", status: null, error: "no DELETE counterpart for POST /symbol-sources/" },
      } as unknown as LooseVerdict,
      // Response had no usable id → manual_cleanup_required.
      {
        method: "POST", path: "/api-keys/",
        cleanup: { attempted: true, id: undefined, deletePath: "", status: null, error: "cleanup skipped: response had no usable id" },
      } as unknown as LooseVerdict,
      // Cleanup never attempted (probe didn't enter cleanup phase) → skipped.
      {
        method: "GET", path: "/orgs/",
        cleanup: { attempted: false },
      } as unknown as LooseVerdict,
    ];

    const written = await persistVerdictsAsOrphans("demo", "run-99", verdicts);
    expect(written).toBe(3); // skip the not-attempted one only

    const records = await loadOrphans({ api: "demo", runId: "run-99" });
    expect(records).toHaveLength(3);
    const manual = records.filter(r => r.requires_manual_cleanup === true);
    expect(manual).toHaveLength(2);
    expect(manual.map(r => r.path).sort()).toEqual(["/api-keys/", "/symbol-sources/"]);
  });

  // ARV-102 (F7): two manual-only records on different (method, path)
  // pairs must survive de-dup independently — earlier they all collapsed
  // to one entry because deletePath/id are empty for the manual branch.
  test("loadOrphans keeps manual-only records distinct across (method, path)", async () => {
    const t = new Date().toISOString();
    await appendOrphanRecord({
      api: "demo", runId: "1", createdAt: t,
      method: "POST", path: "/symbol-sources/", id: "", deletePath: "",
      lastCleanupStatus: null, lastCleanupError: "no DELETE counterpart",
      requires_manual_cleanup: true,
    });
    await appendOrphanRecord({
      api: "demo", runId: "1", createdAt: t,
      method: "POST", path: "/api-keys/", id: "", deletePath: "",
      lastCleanupStatus: null, lastCleanupError: "cleanup skipped: response had no usable id",
      requires_manual_cleanup: true,
    });

    const survivors = await loadOrphans({ api: "demo", runId: "1" });
    expect(survivors.map(r => r.path).sort()).toEqual(["/api-keys/", "/symbol-sources/"]);
  });

  test("JSON envelope splits items vs manual_cleanup_required", async () => {
    fetchHandle = mockFetchRouter(() => ({ status: 204 }));
    const t = new Date().toISOString();
    await appendOrphanRecord({
      api: "demo", runId: "1", createdAt: t,
      method: "POST", path: "/symbol-sources/", id: "src", deletePath: "",
      lastCleanupStatus: null, lastCleanupError: "no DELETE counterpart",
      requires_manual_cleanup: true,
    });

    await cleanupCommand({ orphans: true, baseUrl: "http://srv", json: true });

    const env = JSON.parse(suppress.out) as {
      ok: boolean;
      data: {
        retried: number;
        items: unknown[];
        manual_cleanup_required: Array<{ method: string; path: string; reason: string }>;
      };
    };
    expect(env.ok).toBe(true);
    expect(env.data.retried).toBe(0);
    expect(env.data.items).toEqual([]);
    expect(env.data.manual_cleanup_required).toHaveLength(1);
    expect(env.data.manual_cleanup_required[0]!.path).toBe("/symbol-sources/");
    expect(env.data.manual_cleanup_required[0]!.reason).toMatch(/no DELETE counterpart/);
  });
});
