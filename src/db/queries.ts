/**
 * Façade over the per-domain query modules in `src/db/queries/`.
 * All the implementations moved out in TASK-187 (m-11). This file only
 * re-exports them so existing call sites stay stable; it will be
 * deleted in the next minor (call sites should import from
 * `src/db/queries/<domain>` directly).
 *
 * Layout:
 *   queries/types.ts        — shared interfaces, normalizePath
 *   queries/runs.ts         — createRun, listRuns, finalizeRun, …
 *   queries/sessions.ts     — listSessions, countSessions, …
 *   queries/results.ts      — saveResults, getResultsByRunId, …
 *   queries/collections.ts  — collections CRUD
 *   queries/dashboard.ts    — getDashboardStats, getPassRateTrend, …
 *   queries/settings.ts     — kv settings (currently dormant)
 *   queries/coverage.ts     — reserved (future coverage queries)
 */

export {
  normalizePath,
  type CreateRunOpts,
  type RunRecord,
  type RunSummary,
  type SessionSummary,
  type CollectionRecord,
  type CollectionSummary,
  type CreateCollectionOpts,
  type StoredStepResult,
  type RunFilters,
  type DashboardStats,
  type PassRateTrendPoint,
  type SlowestTest,
  type FlakyTest,
} from "./queries/types.ts";

export {
  createRun,
  finalizeRun,
  getRunById,
  listRuns,
  deleteRun,
  countRuns,
  listRunsByCollectionFiltered,
  getLatestFailingRunId,
  getLatestRunId,
  runKindStats,
  deleteRunsOlderThan,
  type RunKindStat,
} from "./queries/runs.ts";

export { listSessions, countSessions, listRunsBySession } from "./queries/sessions.ts";

export {
  saveResults,
  getResultsByRunId,
  getFilteredResults,
} from "./queries/results.ts";

export {
  createCollection,
  getCollectionById,
  getLatestRunByCollection,
  listCollections,
  updateCollection,
  deleteCollection,
  findCollectionByTestPath,
  findCollectionByNameOrId,
} from "./queries/collections.ts";

export {
  getDashboardStats,
  getPassRateTrend,
  getSlowestTests,
  getFlakyTests,
} from "./queries/dashboard.ts";
