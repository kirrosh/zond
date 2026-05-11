/**
 * TASK-278: persist «probe created this resource and DELETE failed» records to
 * `~/.zond/orphans/<api>/<run-id>.jsonl` so `zond cleanup --orphans` can
 * retry the deletion later — without re-running the probe.
 *
 * One JSON object per line for forward-compatible streaming reads. We never
 * rewrite existing lines; cleanup-success appends a new `removed: true`
 * record that supersedes the original one (loadOrphans collapses
 * supersessions in memory so the on-disk file is append-only and crash-safe).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, readFile, appendFile } from "node:fs/promises";
import type { SecurityVerdict } from "./security-probe.ts";

export interface OrphanRecord {
  api: string;
  runId: string;
  /** ISO timestamp of the cleanup-attempt that produced this record. */
  createdAt: string;
  /** Method/path of the *creating* endpoint (e.g. POST /teams/). */
  method: string;
  path: string;
  /** Captured id of the leaked resource (slug/uuid/numeric id). */
  id: string;
  /** Concrete DELETE URL path with the id already substituted. */
  deletePath: string;
  /** Last DELETE status zond observed; `null` for network errors. */
  lastCleanupStatus: number | null;
  /** Last error string (network message or HTTP-status sentence). */
  lastCleanupError: string | null;
  /** When true, this record cancels a prior orphan with the same
   *  (api, runId, deletePath, id) tuple. Used by `cleanup --orphans` to
   *  mark replayed-and-now-gone resources. */
  removed?: boolean;
  /** ARV-102 (F7): probe knew the resource was created but couldn't
   *  derive a DELETE plan (response had no usable id, or the spec has no
   *  DELETE counterpart for the create endpoint). The record is still
   *  worth keeping so `cleanup --orphans` can surface "manual cleanup
   *  required" — DELETE retry isn't possible, but the user must know.
   *  When set, deletePath / id may be empty and `lastCleanupError`
   *  carries the reason from the probe (e.g. "cleanup skipped: response
   *  had no usable id"). */
  requires_manual_cleanup?: boolean;
}

export function orphansRoot(): string {
  return process.env.ZOND_ORPHANS_DIR ?? join(homedir(), ".zond", "orphans");
}

function recordFile(api: string, runId: string): string {
  return join(orphansRoot(), api, `${runId}.jsonl`);
}

export async function appendOrphanRecord(record: OrphanRecord): Promise<void> {
  const file = recordFile(record.api, record.runId);
  await mkdir(join(orphansRoot(), record.api), { recursive: true });
  await appendFile(file, JSON.stringify(record) + "\n", "utf-8");
}

/**
 * Snapshot a probe-run's verdicts into the orphans store. We persist EVERY
 * cleanup attempt that has a known id (regardless of success) so a SIGINT
 * mid-run still leaves a trace of created resources. Successful DELETEs are
 * written with `lastCleanupStatus` in 2xx — `loadOrphans` will treat them as
 * already-removed and skip them.
 */
export async function persistVerdictsAsOrphans(api: string, runId: string, verdicts: SecurityVerdict[]): Promise<number> {
  let written = 0;
  for (const v of verdicts) {
    const c = v.cleanup;
    if (!c?.attempted) continue;
    // ARV-102 (F7): pre-fix this branch dropped any verdict whose
    // cleanup had no usable id OR no DELETE path (e.g. "no DELETE
    // counterpart for POST /symbol-sources/", "response had no usable
    // id"). Probe digest still counted these as cleanup-failures, but
    // they never reached the orphan registry — `cleanup --orphans` then
    // reported zero, hiding live API leakage. Now we persist a
    // `requires_manual_cleanup: true` record so the operator at least
    // sees "5 resources need manual cleanup".
    const haveDeletePlan = c.id !== undefined && !!c.deletePath;
    if (!haveDeletePlan) {
      const record: OrphanRecord = {
        api,
        runId,
        createdAt: new Date().toISOString(),
        method: v.method.toUpperCase(),
        path: v.path,
        id: c.id !== undefined ? String(c.id) : "",
        deletePath: c.deletePath ?? "",
        lastCleanupStatus: c.status ?? null,
        lastCleanupError: c.error ?? "cleanup skipped: no DELETE plan",
        requires_manual_cleanup: true,
      };
      await appendOrphanRecord(record);
      written++;
      continue;
    }
    const removed = c.status != null && c.status >= 200 && c.status < 300;
    const record: OrphanRecord = {
      api,
      runId,
      createdAt: new Date().toISOString(),
      method: v.method.toUpperCase(),
      path: v.path,
      id: String(c.id),
      deletePath: c.deletePath ?? "",
      lastCleanupStatus: c.status ?? null,
      lastCleanupError: c.error ?? null,
      ...(removed ? { removed: true } : {}),
    };
    await appendOrphanRecord(record);
    written++;
  }
  return written;
}

/**
 * Read every orphan file (optionally filtered by `--api` and `--run`) and
 * return the surviving records — i.e. those NOT yet superseded by a
 * `removed: true` follow-up.
 */
export async function loadOrphans(filter: { api?: string; runId?: string } = {}): Promise<OrphanRecord[]> {
  const root = orphansRoot();
  const apis: string[] = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && (!filter.api || e.name === filter.api)) apis.push(e.name);
    }
  } catch {
    return [];
  }

  const out: OrphanRecord[] = [];
  for (const api of apis) {
    const dir = join(root, api);
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter(f => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const runId = f.replace(/\.jsonl$/, "");
      if (filter.runId && runId !== filter.runId) continue;
      const file = join(dir, f);
      let raw: string;
      try {
        raw = await readFile(file, "utf-8");
      } catch {
        continue;
      }
      // De-dup: later records on the same (api, runId, deletePath, id) win.
      // `removed: true` cancels the entry; non-removed records keep the
      // most recent cleanup status / error.
      // ARV-102 (F7): manual-only records (requires_manual_cleanup) often
      // have empty deletePath / id (probe couldn't derive them), so the
      // standard key would collapse all of them onto a single bucket.
      // Fold method/path into the key for that branch — every distinct
      // (method, path) on which probe gave up survives independently.
      const byKey = new Map<string, OrphanRecord>();
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const r = JSON.parse(trimmed) as OrphanRecord;
          const key = r.requires_manual_cleanup
            ? `${r.api}|${r.runId}|manual|${r.method}|${r.path}|${r.id}`
            : `${r.api}|${r.runId}|${r.deletePath}|${r.id}`;
          if (r.removed) {
            byKey.delete(key);
          } else {
            byKey.set(key, r);
          }
        } catch {
          // Skip malformed lines — best-effort parse.
        }
      }
      for (const r of byKey.values()) out.push(r);
    }
  }
  return out;
}

export async function markRemoved(record: OrphanRecord): Promise<void> {
  await appendOrphanRecord({ ...record, removed: true, lastCleanupStatus: 200, lastCleanupError: null, createdAt: new Date().toISOString() });
}
