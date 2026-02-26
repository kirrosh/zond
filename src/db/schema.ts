import { Database } from "bun:sqlite";
import { resolve } from "path";

let _db: Database | null = null;

export function getDb(dbPath?: string): Database {
  if (_db) return _db;

  const path = dbPath ? resolve(dbPath) : resolve(process.cwd(), "apitool.db");
  const db = new Database(path, { create: true });

  // Performance and integrity settings
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);

  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

const SCHEMA_VERSION = 2;

const SCHEMA_V1 = `
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
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          INTEGER NOT NULL REFERENCES runs(id),
    suite_name      TEXT NOT NULL,
    test_name       TEXT NOT NULL,
    status          TEXT NOT NULL,
    duration_ms     INTEGER NOT NULL,
    request_method  TEXT,
    request_url     TEXT,
    request_body    TEXT,
    response_status INTEGER,
    response_body   TEXT,
    error_message   TEXT,
    assertions      TEXT,
    captures        TEXT
  );

  CREATE TABLE IF NOT EXISTS environments (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL UNIQUE,
    variables TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collections (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    test_path    TEXT NOT NULL,
    openapi_spec TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_runs_started      ON runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_collection    ON runs(collection_id);
  CREATE INDEX IF NOT EXISTS idx_results_run        ON results(run_id);
  CREATE INDEX IF NOT EXISTS idx_results_status     ON results(status);
  CREATE INDEX IF NOT EXISTS idx_results_name       ON results(suite_name, test_name);
  CREATE INDEX IF NOT EXISTS idx_collections_name   ON collections(name);
`;

const SCHEMA_V2 = `
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
  CREATE INDEX IF NOT EXISTS idx_ai_gen_collection ON ai_generations(collection_id);
`;

function runMigrations(db: Database): void {
  const currentVersion = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;

  if (currentVersion >= SCHEMA_VERSION) return;

  db.transaction(() => {
    if (currentVersion < 1) {
      db.exec(SCHEMA_V1);
    }
    if (currentVersion < 2) {
      db.exec(SCHEMA_V2);
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}
