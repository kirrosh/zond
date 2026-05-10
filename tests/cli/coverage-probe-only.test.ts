/**
 * ARV-55 (supersedes ARV-41): probe-only runs are now classified by the
 * persisted `runs.run_kind` column (set at INSERT time by `detectRunKind`)
 * instead of a regex over each result's `suite_file`. Coverage's default
 * loader query filters `run_kind = 'regular'`, so this suite locks two
 * invariants:
 *
 *   1. `isProbeOnlyRun` is a thin column read — it agrees with what
 *      `createRun({ run_kind: 'probe' })` persisted.
 *   2. After a probe run, coverage's default loader continues to use the
 *      prior regular run (the F1-12 quirk closes by design — no silent
 *      regression, no inline warning needed when the *latest* run is
 *      still a regular one).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isProbeOnlyRun } from "../../src/cli/commands/coverage.ts";
import { closeDb, getDb } from "../../src/db/schema.ts";
import { createRun } from "../../src/db/queries/runs.ts";
import { getLatestRunByCollection } from "../../src/db/queries/collections.ts";
import { createCollection } from "../../src/db/queries/collections.ts";

describe("ARV-55: run_kind / isProbeOnlyRun", () => {
  let workDir: string;
  let savedCwd: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "zond-arv55-"));
    writeFileSync(join(workDir, "zond.config.yml"), "version: 1\n", "utf-8");
    savedCwd = process.cwd();
    process.chdir(workDir);
    getDb();
  });

  afterEach(() => {
    process.chdir(savedCwd);
    closeDb();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("run inserted with run_kind='probe' is probe-only", () => {
    const id = createRun({ started_at: "2026-05-10T12:00:00Z", run_kind: "probe" });
    expect(isProbeOnlyRun(id)).toBe(true);
  });

  test("run inserted without run_kind defaults to 'regular' — NOT probe-only", () => {
    const id = createRun({ started_at: "2026-05-10T12:00:00Z" });
    expect(isProbeOnlyRun(id)).toBe(false);
  });

  test("run inserted with run_kind='check' is also NOT probe-only", () => {
    const id = createRun({ started_at: "2026-05-10T12:00:00Z", run_kind: "check" });
    expect(isProbeOnlyRun(id)).toBe(false);
  });

  test("getLatestRunByCollection default (regular) skips probe runs (F1-12 closure)", () => {
    const colId = createCollection({ name: "demo", test_path: "apis/demo/tests" });
    // 1) regular run lands first
    createRun({ started_at: "2026-05-10T12:00:00Z", collection_id: colId, run_kind: "regular" });
    // Mark finished_at so the latest-run query includes it.
    const db = getDb();
    db.exec("UPDATE runs SET finished_at = '2026-05-10T12:00:05Z'");
    // 2) probe run lands after
    const probeId = createRun({ started_at: "2026-05-10T12:01:00Z", collection_id: colId, run_kind: "probe" });
    db.prepare("UPDATE runs SET finished_at = '2026-05-10T12:01:05Z' WHERE id = ?").run(probeId);

    // Default (regular only) picks the *first* run, ignoring the probe one.
    const latest = getLatestRunByCollection(colId);
    expect(latest?.run_kind).toBe("regular");

    // 'any' opts back into legacy behaviour — used for the inline warning.
    const latestAny = getLatestRunByCollection(colId, { runKind: "any" });
    expect(latestAny?.run_kind).toBe("probe");
  });
});
