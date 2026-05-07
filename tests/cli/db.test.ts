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
