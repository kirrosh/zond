import { Database } from "bun:sqlite";
import { resolve } from "path";
import { existsSync } from "fs";
import { findWorkspaceRoot } from "../core/workspace/root.ts";

let _db: Database | null = null;
let _dbPath: string | null = null;

export function getDb(dbPath?: string): Database {
  const path = dbPath
    ? resolve(dbPath)
    : (_dbPath ?? resolve(findWorkspaceRoot().root, "zond.db"));

  // If cached connection exists, verify the file still exists
  if (_db && _dbPath === path && existsSync(path)) return _db;

  // Close stale connection if any
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
    _dbPath = null;
  }
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

export function resetDb(): void {
  if (_db) { try { _db.close(); } catch {} }
  _db = null;
  _dbPath = null;
}

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

const SCHEMA_VERSION = 6;

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
    collection_id INTEGER REFERENCES collections(id)
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

  CREATE TABLE IF NOT EXISTS ai_generations (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id     INTEGER REFERENCES collections(id),
    prompt            TEXT NOT NULL,
    model             TEXT NOT NULL,
    provider          TEXT NOT NULL,
    generated_yaml    TEXT,
    output_path       TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    error_message     TEXT,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    duration_ms       INTEGER,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT,
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_active TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL REFERENCES chat_sessions(id),
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    tool_name     TEXT,
    tool_args     TEXT,
    tool_result   TEXT,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_runs_started      ON runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_collection    ON runs(collection_id);
  CREATE INDEX IF NOT EXISTS idx_results_run        ON results(run_id);
  CREATE INDEX IF NOT EXISTS idx_results_status     ON results(status);
  CREATE INDEX IF NOT EXISTS idx_results_name       ON results(suite_name, test_name);
  CREATE INDEX IF NOT EXISTS idx_collections_name   ON collections(name);
  CREATE INDEX IF NOT EXISTS idx_ai_gen_collection  ON ai_generations(collection_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_active  ON chat_sessions(last_active DESC);

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
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}
