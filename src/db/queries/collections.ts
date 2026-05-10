import { getDb } from "../schema.ts";
import {
  normalizePath,
  type CollectionRecord,
  type CollectionSummary,
  type CreateCollectionOpts,
  type LastRunForSuite,
  type RunRecord,
} from "./types.ts";

export function createCollection(opts: CreateCollectionOpts): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO collections (name, base_dir, test_path, openapi_spec)
    VALUES ($name, $base_dir, $test_path, $openapi_spec)
  `);
  const result = stmt.run({
    $name: opts.name,
    $base_dir: opts.base_dir ?? null,
    $test_path: opts.test_path,
    $openapi_spec: opts.openapi_spec ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function getCollectionById(id: number): CollectionRecord | null {
  const db = getDb();
  return db.query("SELECT * FROM collections WHERE id = ?").get(id) as CollectionRecord | null;
}

export function getLatestRunByCollection(
  collectionId: number,
  opts: { runKind?: "regular" | "probe" | "check" | "any" } = {},
): RunRecord | null {
  const db = getDb();
  // ARV-55: 'regular' is the default so coverage skips probe-only runs
  // without an explicit predicate. 'any' opts back into the legacy
  // behaviour (used by `coverage`'s probe-run hint logic).
  const kind = opts.runKind ?? "regular";
  const kindClause = kind === "any" ? "" : "AND run_kind = ?";
  const params: (string | number)[] = [collectionId];
  if (kind !== "any") params.push(kind);
  const row = db.query(`
    SELECT * FROM runs
    WHERE collection_id = ? AND finished_at IS NOT NULL ${kindClause}
    ORDER BY started_at DESC
    LIMIT 1
  `).get(...params) as (Record<string, unknown> & { tags?: unknown }) | null;
  if (!row) return null;
  let tags: string[] | null = null;
  if (typeof row.tags === "string") {
    try {
      const v = JSON.parse(row.tags);
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) tags = v;
    } catch {
      // legacy/corrupt — leave null
    }
  }
  // ARV-55: normalise run_kind alongside tags so RunRecord stays consistent.
  const rk = row.run_kind;
  const run_kind: import("../../core/runner/run-kind.ts").RunKind =
    rk === "probe" || rk === "check" ? rk : "regular";
  return { ...(row as unknown as RunRecord), tags, run_kind };
}

export function listCollections(): CollectionSummary[] {
  const db = getDb();
  return db.query(`
    SELECT
      c.id, c.name, c.base_dir, c.test_path, c.openapi_spec, c.created_at,
      COUNT(r.id) AS total_runs,
      CASE WHEN SUM(r.total) > 0
        THEN ROUND(SUM(r.passed) * 100.0 / SUM(r.total), 1)
        ELSE 0 END AS pass_rate,
      MAX(r.started_at) AS last_run_at,
      COALESCE((SELECT passed FROM runs WHERE collection_id = c.id ORDER BY started_at DESC LIMIT 1), 0) AS last_run_passed,
      COALESCE((SELECT failed FROM runs WHERE collection_id = c.id ORDER BY started_at DESC LIMIT 1), 0) AS last_run_failed,
      COALESCE((SELECT total FROM runs WHERE collection_id = c.id ORDER BY started_at DESC LIMIT 1), 0) AS last_run_total
    FROM collections c
    LEFT JOIN runs r ON r.collection_id = c.id AND r.finished_at IS NOT NULL
    GROUP BY c.id
    ORDER BY c.name
  `).all() as CollectionSummary[];
}

export function updateCollection(id: number, opts: Partial<CreateCollectionOpts>): boolean {
  const db = getDb();
  const sets: string[] = [];
  const params: Record<string, any> = { $id: id };

  if (opts.name !== undefined) { sets.push("name = $name"); params.$name = opts.name; }
  if (opts.base_dir !== undefined) { sets.push("base_dir = $base_dir"); params.$base_dir = opts.base_dir; }
  if (opts.test_path !== undefined) { sets.push("test_path = $test_path"); params.$test_path = opts.test_path; }
  if (opts.openapi_spec !== undefined) { sets.push("openapi_spec = $openapi_spec"); params.$openapi_spec = opts.openapi_spec; }

  if (sets.length === 0) return false;

  const result = db.prepare(`UPDATE collections SET ${sets.join(", ")} WHERE id = $id`).run(params);
  return result.changes > 0;
}

export function deleteCollection(id: number, deleteRuns = false): boolean {
  const db = getDb();
  if (deleteRuns) {
    const runIds = db.query("SELECT id FROM runs WHERE collection_id = ?").all(id) as { id: number }[];
    for (const row of runIds) {
      db.prepare("DELETE FROM results WHERE run_id = ?").run(row.id);
    }
    db.prepare("DELETE FROM runs WHERE collection_id = ?").run(id);
  } else {
    db.prepare("UPDATE runs SET collection_id = NULL WHERE collection_id = ?").run(id);
  }
  const result = db.prepare("DELETE FROM collections WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findCollectionByTestPath(path: string): CollectionRecord | null {
  const db = getDb();
  const normalized = normalizePath(path);
  return db.query("SELECT * FROM collections WHERE test_path = ?").get(normalized) as CollectionRecord | null;
}

export function findCollectionByNameOrId(nameOrId: string): CollectionRecord | null {
  const db = getDb();
  // Try as numeric ID first
  const id = parseInt(nameOrId, 10);
  if (!isNaN(id)) {
    const byId = db.query("SELECT * FROM collections WHERE id = ?").get(id) as CollectionRecord | null;
    if (byId) return byId;
  }
  // Then by name (case-insensitive)
  return db.query("SELECT * FROM collections WHERE lower(name) = lower(?)").get(nameOrId) as CollectionRecord | null;
}

/**
 * Latest run that included `suiteFile` (matched by step_results.suite_file),
 * with per-suite step counts within that run. Used by the Suites browser UI.
 */
export function getLatestRunForSuite(suiteFile: string): LastRunForSuite | null {
  const db = getDb();
  const row = db.query(`
    SELECT
      r.id AS run_id,
      r.started_at AS started_at,
      COUNT(*) AS total,
      SUM(CASE WHEN s.status = 'pass' THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN s.status IN ('fail', 'error') THEN 1 ELSE 0 END) AS failed
    FROM results s
    JOIN runs r ON r.id = s.run_id
    WHERE s.suite_file = ?
    GROUP BY r.id
    ORDER BY r.id DESC
    LIMIT 1
  `).get(suiteFile) as LastRunForSuite | null;
  if (!row) return null;
  return {
    run_id: row.run_id,
    started_at: row.started_at,
    total: Number(row.total) || 0,
    passed: Number(row.passed) || 0,
    failed: Number(row.failed) || 0,
  };
}
