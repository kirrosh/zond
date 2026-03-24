import { describe, test, expect, mock, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { dbCommand } from "../../src/cli/commands/db.ts";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, finalizeRun } from "../../src/db/queries.ts";

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

function tmpDb(): string {
  return join(tmpdir(), `zond-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const origLog = console.log;
  let captured = "";
  process.stdout.write = mock((data: any) => { captured += String(data); return true; }) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  console.log = mock((...args: unknown[]) => { captured += args.map(String).join(" ") + "\n"; });
  return {
    restore() {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      console.log = origLog;
    },
    getCaptured() { return captured; },
  };
}

describe("dbCommand", () => {
  let output: ReturnType<typeof suppressOutput>;
  let db: string;

  afterEach(() => {
    output?.restore();
    closeDb();
    if (db) tryUnlink(db);
  });

  test("collections --json returns envelope", async () => {
    db = tmpDb();
    output = suppressOutput();
    getDb(db);

    const code = await dbCommand({
      subcommand: "collections",
      positional: [],
      dbPath: db,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("db collections");
  });

  test("runs --json returns runs", async () => {
    db = tmpDb();
    output = suppressOutput();
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
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(true);
    expect(envelope.data.runs.length).toBeGreaterThan(0);
  });

  test("run without ID returns exit 2", async () => {
    db = tmpDb();
    output = suppressOutput();

    const code = await dbCommand({
      subcommand: "run",
      positional: [],
      dbPath: db,
      json: true,
    });
    expect(code).toBe(2);
  });

  test("unknown subcommand returns exit 2", async () => {
    output = suppressOutput();
    const code = await dbCommand({
      subcommand: "unknown",
      positional: [],
      json: true,
    });
    expect(code).toBe(2);
  });
});
