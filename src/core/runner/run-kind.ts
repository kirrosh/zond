/**
 * ARV-55: single source of truth for classifying a run by *what kind of
 * suites it executed*. Before this module the answer was inferred from
 * `suite_file` paths in three places (coverage's `isProbeOnlyRun`,
 * `db diagnose` recommendation branching, and a handful of skill prompts).
 *
 * We resolve the kind once at INSERT-time and persist it in `runs.run_kind`;
 * downstream filters become a column compare instead of a per-result regex.
 *
 * Encoding:
 *   - `probe`   — every suite path lives under `apis/<api>/probes/` (or a
 *                 bare `probes/` segment for ad-hoc setups). Coverage hides
 *                 these by default — probe runs deliberately exercise a
 *                 subset of endpoints and would otherwise read as a
 *                 regression vs the prior smoke/CRUD run.
 *   - `check`   — every suite path lives under `apis/<api>/checks/`. Mirrors
 *                 the same logic: conformance checks don't reflect endpoint
 *                 coverage breadth.
 *   - `request` — a single ad-hoc `zond request` invocation persisted into
 *                 the session DB (ARV-265). Excluded from `pass-coverage`
 *                 but counted toward `audit-coverage`.
 *   - `fixture` — `prepare-fixtures --cascade` discovery list-calls
 *                 (ARV-265). Pure HTTP touches in service of fixture
 *                 derivation; audit-coverage only.
 *   - `regular` — anything else, including mixed runs (probe + smoke). A
 *                 mixed run is treated as regular because at least one
 *                 suite contributed real coverage signal.
 */

export type RunKind = "regular" | "probe" | "check" | "request" | "fixture";

const PROBE_SEGMENT_RE = /(^|\/)probes(\/|$)/;
const CHECK_SEGMENT_RE = /(^|\/)checks(\/|$)/;

export function detectRunKind(suiteFiles: ReadonlyArray<string | null | undefined>): RunKind {
  // Empty / all-empty arrays default to 'regular' — the DB CHECK constraint
  // refuses NULL so callers always receive a concrete kind.
  const paths = suiteFiles
    .filter((p): p is string => typeof p === "string" && p.length > 0);
  if (paths.length === 0) return "regular";

  if (paths.every((p) => PROBE_SEGMENT_RE.test(p))) return "probe";
  if (paths.every((p) => CHECK_SEGMENT_RE.test(p))) return "check";
  return "regular";
}
