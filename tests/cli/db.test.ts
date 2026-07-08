import { describe, test, expect, afterEach } from "bun:test";
import { dbCommand } from "../../src/cli/commands/db.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun } from "../../src/db/queries.ts";
import { tmpDb, unlinkDb as tryUnlink } from "../_helpers/tmp-db";

import { captureOutput } from "../_helpers/output";

describe("dbCommand", () => {
  let output: ReturnType<typeof captureOutput>;
  let db: string;

  afterEach(() => {
    output?.restore();
    closeDb();
    if (db) tryUnlink(db);
  });

  test("collections --json returns envelope", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);

    const code = await dbCommand({
      subcommand: "collections",
      positional: [],
      dbPath: db,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.out);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("db collections");
  });

  test("runs --json returns runs", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);
    const runId = createRun({ started_at: new Date().toISOString() });
    finalizeRun(runId, []);

    const code = await dbCommand({
      subcommand: "runs",
      positional: [],
      dbPath: db,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.out);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.runs.length).toBeGreaterThan(0);
  });

  test("run without ID returns exit 2", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });

    const code = await dbCommand({
      subcommand: "run",
      positional: [],
      dbPath: db,
      json: true,
    });
    expect(code).toBe(2);
  });

  test("unknown subcommand returns exit 2", async () => {
    output = captureOutput({ console: true });
    const code = await dbCommand({
      subcommand: "unknown",
      positional: [],
      json: true,
    });
    expect(code).toBe(2);
  });

  test("TASK-74: every db --json command emits the same envelope shape", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);
    const runIdA = createRun({ started_at: new Date().toISOString() });
    finalizeRun(runIdA, []);
    const runIdB = createRun({ started_at: new Date().toISOString() });
    finalizeRun(runIdB, []);

    const subcommands: Array<{ subcommand: string; positional: string[] }> = [
      { subcommand: "collections", positional: [] },
      { subcommand: "runs", positional: [] },
      { subcommand: "run", positional: [String(runIdA)] },
      { subcommand: "diagnose", positional: [String(runIdA)] },
      { subcommand: "compare", positional: [String(runIdA), String(runIdB)] },
    ];

    const ENVELOPE_KEYS = ["ok", "command", "data", "warnings", "errors"].sort();
    for (const { subcommand, positional } of subcommands) {
      output.restore();
      output = captureOutput({ console: true });
      const code = await dbCommand({ subcommand, positional, dbPath: db, json: true });
      expect(code).toBe(0);
      const envelope = JSON.parse(output.out);
      expect(Object.keys(envelope).sort()).toEqual(ENVELOPE_KEYS);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe(`db ${subcommand}`);
      expect(Array.isArray(envelope.warnings)).toBe(true);
      expect(Array.isArray(envelope.errors)).toBe(true);
    }
  });

  // ARV-338: `--report yaml` emits the same payload as YAML.
  test("run/diagnose/compare --report yaml emit parseable YAML", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);
    const runIdA = createRun({ started_at: new Date().toISOString() });
    finalizeRun(runIdA, []);
    const runIdB = createRun({ started_at: new Date().toISOString() });
    finalizeRun(runIdB, []);

    const { parse: parseYaml } = await import("yaml");
    const cases: Array<{ subcommand: string; positional: string[]; key: string }> = [
      { subcommand: "run", positional: [String(runIdA)], key: "run" },
      { subcommand: "diagnose", positional: [String(runIdA)], key: "summary" },
      { subcommand: "compare", positional: [String(runIdA), String(runIdB)], key: "summary" },
    ];
    for (const { subcommand, positional, key } of cases) {
      output.restore();
      output = captureOutput({ console: true });
      const code = await dbCommand({ subcommand, positional, report: "yaml", dbPath: db, json: false });
      expect(code).toBe(0);
      const doc = parseYaml(output.out) as Record<string, unknown>;
      expect(doc[key]).toBeDefined();
    }
  });

  test("--report yaml with --json is rejected", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    const code = await dbCommand({ subcommand: "run", positional: ["1"], report: "yaml", dbPath: db, json: true });
    expect(code).toBe(2);
  });

  test("--report with unknown format is rejected", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    const code = await dbCommand({ subcommand: "run", positional: ["1"], report: "xml", dbPath: db, json: false });
    expect(code).toBe(2);
  });

  // TASK-266: `db diagnose` without an id targets the most recent failing run.
  test("diagnose without id picks latest failing run (TASK-266)", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);

    const passId = createRun({ started_at: "2026-01-01T00:00:00Z" });
    finalizeRun(passId, []);
    const failId = createRun({ started_at: "2026-01-02T00:00:00Z" });
    const dbh = getDb(db);
    dbh.prepare(`UPDATE runs SET total=3, passed=2, failed=1 WHERE id=?`).run(failId);
    // Newer passing run should NOT mask the older failing one.
    const newerPassId = createRun({ started_at: "2026-01-03T00:00:00Z" });
    finalizeRun(newerPassId, []);

    const code = await dbCommand({
      subcommand: "diagnose",
      positional: [],
      dbPath: db,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.out);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.run_id).toBe(failId);
    expect(envelope.data.resolution).toBe("latest-failing");
  });

  // TASK-266: --latest opts out of the "must be failing" filter.
  test("diagnose --latest picks the most recent run regardless of status", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);
    const failId = createRun({ started_at: "2026-01-01T00:00:00Z" });
    const dbh = getDb(db);
    dbh.prepare(`UPDATE runs SET total=2, passed=1, failed=1 WHERE id=?`).run(failId);
    const passId = createRun({ started_at: "2026-01-02T00:00:00Z" });
    finalizeRun(passId, []);

    const code = await dbCommand({
      subcommand: "diagnose",
      positional: [],
      latest: true,
      dbPath: db,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.out);
    expect(envelope.data.run_id).toBe(passId);
    expect(envelope.data.resolution).toBe("latest");
  });

  // TASK-266: when nothing has failed, fall back to latest run + "no failures" warning.
  test("diagnose with no failing runs falls back to latest with warning", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);
    const passId = createRun({ started_at: "2026-01-01T00:00:00Z" });
    finalizeRun(passId, []);

    const code = await dbCommand({
      subcommand: "diagnose",
      positional: [],
      dbPath: db,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.out);
    expect(envelope.data.run_id).toBe(passId);
    expect(envelope.data.resolution).toBe("latest-no-failures");
    expect(envelope.warnings.some((w: string) => w.includes("No failing runs"))).toBe(true);
  });

  // TASK-266: empty database → exit 1, not 2.
  test("diagnose with empty database returns exit 1", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);
    const code = await dbCommand({
      subcommand: "diagnose",
      positional: [],
      dbPath: db,
      json: true,
    });
    expect(code).toBe(1);
  });

  test("runs prints FAIL when 0 passed despite failed=0 (errors only)", async () => {
    db = tmpDb();
    output = captureOutput({ console: true });
    getDb(db);
    const runId = createRun({ started_at: new Date().toISOString() });
    // Manually finalize with passed=0, failed=0, total>0 to simulate all-errored run
    const dbh = getDb(db);
    dbh.prepare(`
      UPDATE runs SET finished_at = ?, total = 5, passed = 0, failed = 0, skipped = 0, duration_ms = 0
      WHERE id = ?
    `).run(new Date().toISOString(), runId);

    const code = await dbCommand({
      subcommand: "runs",
      positional: [],
      dbPath: db,
      json: false,
    });
    expect(code).toBe(0);
    expect(output.out).toContain("FAIL");
    expect(output.out).not.toContain(`#${runId} PASS`);
  });
});
