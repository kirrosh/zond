import { Database } from "bun:sqlite";
import { dirname, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { findWorkspaceRoot } from "../core/workspace/root.ts";

let _db: Database | null = null;
let _dbPath: string | null = null;

/**
 * Default DB path lives under `<workspace>/.zond/zond.db` to keep runtime
 * artifacts out of the project root. For back-compat we still recognise a
 * legacy `<workspace>/zond.db` if it exists — old workspaces keep working
 * without migration.
 */
function defaultDbPath(): string {
  const root = findWorkspaceRoot().root;
  const legacy = resolve(root, "zond.db");
  if (existsSync(legacy)) return legacy;
  return resolve(root, ".zond", "zond.db");
}

export function getDb(dbPath?: string): Database {
  const path = dbPath ? resolve(dbPath) : (_dbPath ?? defaultDbPath());

  // If cached connection exists, verify the file still exists
  if (_db && _dbPath === path && existsSync(path)) return _db;

  // Close stale connection if any
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
    _dbPath = null;
  }
  // SQLite won't auto-create parent dirs; ensure `.zond/` (or any custom
  // path's parent) exists before opening the file.
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

  const db = new Database(path, { create: true });

  // Performance and integrity settings
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);

  _db = db;
  _dbPath = path;
  return db;
}

export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
    _dbPath = null;
  }
}

function resetDb(): void {
  if (_db) { try { _db.close(); } catch {} }
  _db = null;
  _dbPath = null;
}

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

const SCHEMA_VERSION = 10;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    total         INTEGER NOT NULL DEFAULT 0,
    passed        INTEGER NOT NULL DEFAULT 0,
    failed        INTEGER NOT NULL DEFAULT 0,
    skipped       INTEGER NOT NULL DEFAULT 0,
    trigger       TEXT DEFAULT 'manual',
    commit_sha    TEXT,
    branch        TEXT,
    environment   TEXT,
    duration_ms   INTEGER,
    collection_id INTEGER REFERENCES collections(id),
    session_id    TEXT,
    tags          TEXT,
    -- ARV-55: classify a run once at INSERT time so coverage / diagnose
    -- queries don't have to re-derive "is this a probe-only run?" from
    -- the results' suite_file paths.
    run_kind      TEXT NOT NULL DEFAULT 'regular' CHECK (run_kind IN ('regular','probe','check'))
  );

  CREATE TABLE IF NOT EXISTS results (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id           INTEGER NOT NULL REFERENCES runs(id),
    suite_name       TEXT NOT NULL,
    test_name        TEXT NOT NULL,
    status           TEXT NOT NULL,
    duration_ms      INTEGER NOT NULL,
    request_method   TEXT,
    request_url      TEXT,
    request_body     TEXT,
    response_status  INTEGER,
    response_body    TEXT,
    error_message    TEXT,
    assertions       TEXT,
    captures         TEXT,
    response_headers TEXT,
    suite_file       TEXT,
    provenance       TEXT,
    failure_class    TEXT,
    failure_class_reason TEXT,
    spec_pointer     TEXT,
    spec_excerpt     TEXT
  );

  CREATE TABLE IF NOT EXISTS collections (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    test_path    TEXT NOT NULL,
    openapi_spec TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    base_dir     TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_runs_started      ON runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_collection    ON runs(collection_id);
  CREATE INDEX IF NOT EXISTS idx_runs_session       ON runs(session_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_results_run        ON results(run_id);
  CREATE INDEX IF NOT EXISTS idx_results_status     ON results(status);
  CREATE INDEX IF NOT EXISTS idx_results_name       ON results(suite_name, test_name);
  CREATE INDEX IF NOT EXISTS idx_collections_name   ON collections(name);

  CREATE TABLE IF NOT EXISTS lint_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    spec_path       TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    total           INTEGER NOT NULL DEFAULT 0,
    high_count      INTEGER NOT NULL DEFAULT 0,
    medium_count    INTEGER NOT NULL DEFAULT 0,
    low_count       INTEGER NOT NULL DEFAULT 0,
    endpoint_count  INTEGER NOT NULL DEFAULT 0,
    config_json     TEXT,
    issues_json     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_lint_runs_spec ON lint_runs(spec_path, started_at DESC);
`;

function runMigrations(db: Database): void {
  const ver = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (ver >= SCHEMA_VERSION) return;

  db.transaction(() => {
    if (ver === 0) {
      // Fresh database — create all tables
      db.exec(SCHEMA);
    }
    if (ver >= 1 && ver < 2) {
      // Migration v1→v2: add suite_file column to results
      db.exec("ALTER TABLE results ADD COLUMN suite_file TEXT");
    }
    if (ver >= 2 && ver < 3) {
      // Migration v2→v3: add provenance column (test source metadata)
      db.exec("ALTER TABLE results ADD COLUMN provenance TEXT");
    }
    if (ver >= 3 && ver < 4) {
      // Migration v3→v4: add failure classification columns
      db.exec("ALTER TABLE results ADD COLUMN failure_class TEXT");
      db.exec("ALTER TABLE results ADD COLUMN failure_class_reason TEXT");
    }
    if (ver >= 4 && ver < 5) {
      // Migration v4→v5: add spec_pointer + spec_excerpt (frozen OpenAPI evidence)
      db.exec("ALTER TABLE results ADD COLUMN spec_pointer TEXT");
      db.exec("ALTER TABLE results ADD COLUMN spec_excerpt TEXT");
    }
    if (ver >= 5 && ver < 6) {
      // Migration v5→v6: add lint_runs table for `zond lint-spec` history.
      db.exec(`
        CREATE TABLE IF NOT EXISTS lint_runs (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          spec_path       TEXT NOT NULL,
          started_at      TEXT NOT NULL,
          finished_at     TEXT,
          total           INTEGER NOT NULL DEFAULT 0,
          high_count      INTEGER NOT NULL DEFAULT 0,
          medium_count    INTEGER NOT NULL DEFAULT 0,
          low_count       INTEGER NOT NULL DEFAULT 0,
          endpoint_count  INTEGER NOT NULL DEFAULT 0,
          config_json     TEXT,
          issues_json     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_lint_runs_spec ON lint_runs(spec_path, started_at DESC);
      `);
    }
    if (ver >= 6 && ver < 7) {
      // Migration v6→v7: add session_id column to runs for grouping CLI invocations
      // (e.g. `zond hunt`, scripted post-init runs) into one campaign.
      db.exec("ALTER TABLE runs ADD COLUMN session_id TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, started_at DESC)");
    }
    if (ver >= 7 && ver < 8) {
      // Migration v7→v8: drop the unused AI/chat tables. They were a legacy
      // experiment (in-app chat-driven YAML generation) that never shipped a
      // user-facing surface and have no consumers in the codebase.
      db.exec("DROP TABLE IF EXISTS chat_messages");
      db.exec("DROP TABLE IF EXISTS chat_sessions");
      db.exec("DROP TABLE IF EXISTS ai_generations");
    }
    if (ver >= 8 && ver < 9) {
      // Migration v8→v9: tags column on runs (JSON array of strings — union
      // of suite-level tags actually executed in the run, plus any explicit
      // --tag filters). Powers `coverage --union tag:<name>` (TASK-274).
      db.exec("ALTER TABLE runs ADD COLUMN tags TEXT");
    }
    if (ver >= 9 && ver < 10) {
      // Migration v9→v10 (ARV-55): classify each historical run by suite
      // kind so coverage's default query becomes a column compare. The
      // CHECK constraint can't be added retroactively without a table
      // rebuild — accept the looser column for legacy rows; new INSERTs
      // go through `createRun()` which only emits known kinds.
      db.exec("ALTER TABLE runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'regular'");
      // Backfill: derive kind per existing run from its stored results.
      // `every` semantics mirror the runtime `detectRunKind` helper —
      // pure-probe / pure-check vs anything else.
      db.exec(`
        UPDATE runs SET run_kind = 'probe'
        WHERE id IN (
          SELECT r.id FROM runs r
          WHERE EXISTS (SELECT 1 FROM results WHERE run_id = r.id AND suite_file IS NOT NULL AND suite_file LIKE '%probes/%')
            AND NOT EXISTS (SELECT 1 FROM results WHERE run_id = r.id AND suite_file IS NOT NULL AND suite_file NOT LIKE '%probes/%')
        )
      `);
      db.exec(`
        UPDATE runs SET run_kind = 'check'
        WHERE id IN (
          SELECT r.id FROM runs r
          WHERE EXISTS (SELECT 1 FROM results WHERE run_id = r.id AND suite_file IS NOT NULL AND suite_file LIKE '%checks/%')
            AND NOT EXISTS (SELECT 1 FROM results WHERE run_id = r.id AND suite_file IS NOT NULL AND suite_file NOT LIKE '%checks/%')
        )
      `);
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}
