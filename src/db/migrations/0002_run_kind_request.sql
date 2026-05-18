-- ARV-265 (m-22): extend `runs.run_kind` CHECK constraint to include
-- 'request' (zond request in-session) and 'fixture' (prepare-fixtures
-- cascade list-calls), so audit-coverage can attribute HTTP touches
-- back to those producers.
--
-- The CHECK constraint can't be added with ALTER TABLE in SQLite. Bun's
-- bun:sqlite also locks `sqlite_master` against direct UPDATEs, so the
-- usual `PRAGMA writable_schema=1` rewrite is rejected. We use the
-- canonical SQLite 12-step rebuild: create a parallel table with the
-- new constraint, copy rows over, drop the old, rename.
--
-- The migration runner wraps this in a transaction. FK references from
-- `results.run_id` to `runs(id)` survive the DROP+RENAME because SQLite
-- resolves FK targets by name at row-modification time, not at table
-- definition time — when the new `runs` ends up with the same name the
-- soft reference is reattached transparently. Indexes are explicitly
-- recreated post-rename (they don't survive a DROP).

CREATE TABLE runs_new (
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
  run_kind      TEXT NOT NULL DEFAULT 'regular'
                CHECK (run_kind IN ('regular','probe','check','request','fixture'))
);

INSERT INTO runs_new (
  id, started_at, finished_at, total, passed, failed, skipped, trigger,
  commit_sha, branch, environment, duration_ms, collection_id, session_id,
  tags, run_kind
)
SELECT
  id, started_at, finished_at, total, passed, failed, skipped, trigger,
  commit_sha, branch, environment, duration_ms, collection_id, session_id,
  tags,
  CASE
    WHEN run_kind IN ('regular','probe','check','request','fixture') THEN run_kind
    ELSE 'regular'
  END
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

CREATE INDEX IF NOT EXISTS idx_runs_started    ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_collection ON runs(collection_id);
CREATE INDEX IF NOT EXISTS idx_runs_session    ON runs(session_id, started_at DESC);
