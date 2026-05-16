/**
 * ARV-127: migration runner unit + integration pin.
 */
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations, listShippedMigrations } from "../../src/db/migrate.ts";
import { getDb } from "../../src/db/schema.ts";

function freshDb(): Database {
  return new Database(":memory:");
}

describe("applyMigrations (ARV-127)", () => {
  test("creates schema_migrations table on first run (AC#3)", () => {
    const db = freshDb();
    applyMigrations(db, { migrations: [] });
    const rows = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").all();
    expect(rows.length).toBe(1);
  });

  test("applies pending migrations exactly once across two calls (AC#4)", () => {
    const db = freshDb();
    db.exec("CREATE TABLE widgets (id INTEGER PRIMARY KEY)");
    const stub = [
      { id: "0100_add_color", sql: "ALTER TABLE widgets ADD COLUMN color TEXT" },
    ];

    const first = applyMigrations(db, { migrations: stub, legacySeed: [] });
    expect(first.applied).toEqual(["0100_add_color"]);
    expect(first.skipped).toEqual([]);

    const second = applyMigrations(db, { migrations: stub, legacySeed: [] });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["0100_add_color"]);

    const cols = db.query("PRAGMA table_info(widgets)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name).sort()).toEqual(["color", "id"]);
  });

  test("rolls back the failing migration's transaction; later migrations don't run", () => {
    const db = freshDb();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    const stub = [
      { id: "0001_ok", sql: "ALTER TABLE t ADD COLUMN a TEXT" },
      { id: "0002_bad", sql: "ALTER TABLE nope ADD COLUMN x TEXT" }, // missing table
      { id: "0003_skipped", sql: "ALTER TABLE t ADD COLUMN b TEXT" },
    ];
    expect(() => applyMigrations(db, { migrations: stub, legacySeed: [] })).toThrow();

    // 0001 succeeded, 0002 rolled back, 0003 never attempted.
    const cols = (db.query("PRAGMA table_info(t)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("a");
    expect(cols).not.toContain("b");
    const recorded = (db.query("SELECT id FROM schema_migrations").all() as Array<{ id: string }>).map((r) => r.id);
    expect(recorded).toEqual(["0001_ok"]);
  });

  test("legacy-seed marks ids as applied without running them (AC#5)", () => {
    // Simulate an existing DB that already ran the inline v10 migration:
    // run_kind column exists, user_version = 10. Re-running 0001 would
    // throw "duplicate column" — the legacy-seed branch must skip it.
    const db = freshDb();
    db.exec("CREATE TABLE runs (id INTEGER PRIMARY KEY, run_kind TEXT NOT NULL DEFAULT 'regular')");
    db.exec("PRAGMA user_version = 10");

    const stub = [
      { id: "0001_run_kind", sql: "ALTER TABLE runs ADD COLUMN run_kind TEXT" },
    ];
    const seed = [{ id: "0001_run_kind", minUserVersion: 10 }];

    const result = applyMigrations(db, { migrations: stub, legacySeed: seed });
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(["0001_run_kind"]);
  });

  test("legacy-seed inactive when user_version < threshold (fresh DB)", () => {
    const db = freshDb();
    db.exec("CREATE TABLE runs (id INTEGER PRIMARY KEY)");
    db.exec("PRAGMA user_version = 0");
    const stub = [
      { id: "0001_run_kind", sql: "ALTER TABLE runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'regular'" },
    ];
    const seed = [{ id: "0001_run_kind", minUserVersion: 10 }];

    const result = applyMigrations(db, { migrations: stub, legacySeed: seed });
    expect(result.applied).toEqual(["0001_run_kind"]);
    const cols = (db.query("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("run_kind");
  });

  test("listShippedMigrations names the bundled scripts", () => {
    expect(listShippedMigrations()).toContain("0001_run_kind");
  });

  test("getDb integration: schema_migrations exists and 0001 is recorded (AC#1, AC#2, AC#5)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "zond-migrate-"));
    try {
      const db = getDb(join(tmp, "zond.db"));
      const rows = (db.query("SELECT id FROM schema_migrations").all() as Array<{ id: string }>).map((r) => r.id);
      expect(rows).toContain("0001_run_kind");
      // The legacy inline migration already created the column; we're
      // just verifying no exception was thrown by the file-based runner.
      const cols = (db.query("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols).toContain("run_kind");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
