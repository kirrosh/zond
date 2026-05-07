/**
 * Reserved for coverage-domain DB queries. As of TASK-187, coverage
 * tables (`coverage_runs`, etc.) are still managed entirely from
 * `src/core/coverage/`; nothing in `queries.ts` was coverage-specific to
 * move here. The file exists so the per-domain layout is future-proof
 * — when a coverage table-backed feature lands, queries land here and
 * the cli/UI imports stay stable.
 */
export {};
