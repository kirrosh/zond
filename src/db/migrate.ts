/**
 * ARV-127 (m-19): file-based SQLite migration runner.
 *
 * Why a new runner. The legacy migration path in `schema.ts`
 * (`runMigrations` + `PRAGMA user_version`) is fine for the additive
 * column changes shipped through v10, but the knowledge-base work
 * planned past m-19 will need richer migrations (multi-statement,
 * data backfills, optional rollback notes). Inlining those as `if
 * (ver >= N && ver < N+1)` blocks in TypeScript stops scaling once
 * each migration becomes a small project of its own.
 *
 * This module sits on top of the legacy path:
 *   - `runMigrations()` is untouched — it owns the PRAGMA-version era
 *     and keeps fresh DBs / older snapshots correct.
 *   - `applyMigrations()` runs *after* `runMigrations()`, walks the
 *     registered migration list, and applies anything not yet recorded
 *     in `schema_migrations`. New work (v11+) lands as files; the
 *     0001_run_kind.sql file mirrors the most recent legacy migration
 *     so the two systems agree on the post-v10 schema for fresh DBs.
 *
 * Existing-DB compatibility (AC#5). On a `.zond/zond.db` that already
 * survived the legacy `runMigrations` path (user_version >= 10), the
 * `run_kind` column already exists — re-running `0001_run_kind.sql`
 * would throw a `duplicate column` error. We seed the legacy ids into
 * `schema_migrations` once, on first contact with the new runner, so
 * those rows are treated as "already applied" without executing.
 *
 * Distribution. The SQL bodies are imported as embedded text so
 * `bun build --compile` packs them into the binary (no on-disk
 * lookup at runtime — same pattern as the init/templates skills).
 */
import type { Database } from "bun:sqlite";

import migration_0001_run_kind from "./migrations/0001_run_kind.sql" with { type: "text" };
import migration_0002_run_kind_request from "./migrations/0002_run_kind_request.sql" with { type: "text" };
import migration_0003_check_findings from "./migrations/0003_check_findings.sql" with { type: "text" };

/** Migration manifest. Each entry is a `{ id, sql }` pair; order in
 *  this array is the apply order, matching the lexical sort that the
 *  Django / Rails-style `<id>_<slug>.sql` convention would produce on
 *  disk. Adding a new migration = add a text-import + push to this
 *  list. The runner reads this constant, not the filesystem. */
const MIGRATIONS: ReadonlyArray<{ id: string; sql: string }> = [
  { id: "0001_run_kind", sql: migration_0001_run_kind },
  { id: "0002_run_kind_request", sql: migration_0002_run_kind_request },
  { id: "0003_check_findings", sql: migration_0003_check_findings },
];

/** Pre-existing migration ids that were already applied by the legacy
 *  PRAGMA-version path. When the new runner first encounters a DB
 *  whose `user_version >= 10`, we record these as applied without
 *  running them — the inline `runMigrations` already did. */
const LEGACY_SEED_IDS: ReadonlyArray<{ id: string; minUserVersion: number }> = [
  { id: "0001_run_kind", minUserVersion: 10 },
];

function currentUserVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  return row?.user_version ?? 0;
}

/**
 * Idempotently apply every pending migration. Safe to call on every
 * DB open — the registry table makes the no-op case cheap.
 *
 * Failure semantics: each migration runs in its own transaction. A
 * script that throws (bad SQL, constraint violation) rolls its own
 * statements back and re-raises; later migrations don't run. The
 * caller (DB open path) treats this as fatal — there is no partial
 * upgrade.
 *
 * The optional `overrides` parameter lets tests inject a synthetic
 * migration list (e.g. to exercise a migration order or a failing
 * script) without touching the shipped manifest.
 */
export function applyMigrations(
  db: Database,
  overrides?: { migrations?: ReadonlyArray<{ id: string; sql: string }>; legacySeed?: ReadonlyArray<{ id: string; minUserVersion: number }> },
): { applied: string[]; skipped: string[] } {
  const migrations = overrides?.migrations ?? MIGRATIONS;
  const legacySeed = overrides?.legacySeed ?? LEGACY_SEED_IDS;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Legacy seed: mark already-applied-by-the-PRAGMA-runner ids as done.
  const userVersion = currentUserVersion(db);
  const insertSeed = db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)",
  );
  for (const seed of legacySeed) {
    if (userVersion >= seed.minUserVersion) {
      insertSeed.run(seed.id);
    }
  }

  const appliedRows = db
    .query("SELECT id FROM schema_migrations")
    .all() as Array<{ id: string }>;
  const alreadyApplied = new Set(appliedRows.map((r) => r.id));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.id)) {
      skipped.push(migration.id);
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(migration.id);
    })();
    applied.push(migration.id);
  }

  return { applied, skipped };
}

/** Exported for tests + downstream tooling that wants to know which
 *  migration ids ship with the binary. */
export function listShippedMigrations(): string[] {
  return MIGRATIONS.map((m) => m.id);
}
