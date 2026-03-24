import { describe, test, expect, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { getDb, closeDb } from "../../src/db/schema.ts";

function tmpDb(): string {
  return join(tmpdir(), `zond-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function tryUnlink(path: string): void {
  // WAL mode creates -wal and -shm sidecar files; cleanup is best-effort on Windows
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe("getDb / schema", () => {
  let dbPath: string | undefined;

  afterEach(() => {
    closeDb();
    if (dbPath) { tryUnlink(dbPath); dbPath = undefined; }
  });

  test("creates the db file at the given path", () => {
    dbPath = tmpDb();
    getDb(dbPath);
    expect(existsSync(dbPath)).toBe(true);
  });

  test("returns the same singleton on repeated calls", () => {
    dbPath = tmpDb();
    const a = getDb(dbPath);
    const b = getDb(dbPath);
    expect(a).toBe(b);
  });

  test("creates runs table", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'").all();
    expect(rows).toHaveLength(1);
  });

  test("creates results table", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='results'").all();
    expect(rows).toHaveLength(1);
  });

  test("does not create environments table (removed in V7)", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='environments'").all();
    expect(rows).toHaveLength(0);
  });

  test("creates collections table", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='collections'").all();
    expect(rows).toHaveLength(1);
  });

  test("creates all indexes", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[];
    const names = indexes.map((r) => r.name);
    expect(names).toContain("idx_runs_started");
    expect(names).toContain("idx_results_run");
    expect(names).toContain("idx_results_status");
    expect(names).toContain("idx_results_name");
    expect(names).toContain("idx_runs_collection");
    expect(names).toContain("idx_collections_name");
  });

  test("enables WAL journal mode", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const row = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode).toBe("wal");
  });

  test("enables foreign keys", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const row = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  test("sets user_version to latest after migration", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBe(2);
  });

  test("closeDb resets singleton so next call opens fresh db", () => {
    const path1 = tmpDb();
    const path2 = tmpDb();
    try {
      const db1 = getDb(path1);
      closeDb();
      const db2 = getDb(path2);
      expect(db1).not.toBe(db2);
    } finally {
      closeDb();
      tryUnlink(path1);
      tryUnlink(path2);
      dbPath = undefined;
    }
  });

  test("getDb() without args reuses existing singleton path", () => {
    const path1 = tmpDb();
    try {
      const db1 = getDb(path1);
      const db2 = getDb(); // no args — should reuse path1
      expect(db2).toBe(db1);
    } finally {
      closeDb();
      tryUnlink(path1);
      dbPath = undefined;
    }
  });

  test("re-opening existing db does not re-run migrations (idempotent)", () => {
    dbPath = tmpDb();
    getDb(dbPath);
    closeDb();
    // Should not throw or duplicate tables
    const db = getDb(dbPath);
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'").all();
    expect(rows).toHaveLength(1);
  });
});
