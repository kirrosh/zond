-- ARV-127 (m-19): captures the legacy v9→v10 inline migration as the
-- first file-based migration of the new runner. Mirrors the SQL block
-- previously written in src/db/schema.ts `runMigrations()`. Existing
-- `.zond/zond.db` files that already ran the inline migration are
-- pre-seeded as "applied" by `applyMigrations`, so this script never
-- re-executes the ALTER on a DB where `run_kind` already exists.
--
-- Source: ARV-55 — classify each historical run by suite kind so the
-- coverage default query becomes a column compare.

ALTER TABLE runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'regular';

UPDATE runs SET run_kind = 'probe'
WHERE id IN (
  SELECT r.id FROM runs r
  WHERE EXISTS (SELECT 1 FROM results WHERE run_id = r.id AND suite_file IS NOT NULL AND suite_file LIKE '%probes/%')
    AND NOT EXISTS (SELECT 1 FROM results WHERE run_id = r.id AND suite_file IS NOT NULL AND suite_file NOT LIKE '%probes/%')
);

UPDATE runs SET run_kind = 'check'
WHERE id IN (
  SELECT r.id FROM runs r
  WHERE EXISTS (SELECT 1 FROM results WHERE run_id = r.id AND suite_file IS NOT NULL AND suite_file LIKE '%checks/%')
    AND NOT EXISTS (SELECT 1 FROM results WHERE run_id = r.id AND suite_file IS NOT NULL AND suite_file NOT LIKE '%checks/%')
);
