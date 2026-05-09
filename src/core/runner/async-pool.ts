/**
 * ARV-8 (m-15): bounded async-pool for `zond checks run --workers N`.
 *
 * Cooperative concurrency on a single Bun event loop — no threading,
 * no Workers, just N coroutines that pull from a shared cursor. The
 * design choice is deliberate:
 *
 *   * Threads/Workers would need request-context plumbing (auth headers,
 *     rate-limiter state, per-run schema validators are not transferable
 *     without serialization), and Bun's HTTP client is already
 *     non-blocking — so cooperative concurrency is faster *and* simpler.
 *   * `Promise.all(items.map(fn))` would saturate at items.length, which
 *     defeats the rate-limiter and tends to drown small mock servers.
 *
 * `runPool` preserves input order in the result array — callers (the
 * checks runner, mainly) want to merge per-op findings deterministically
 * regardless of which worker finished first.
 */
import os from "node:os";

const WORKERS_MIN = 1;
const WORKERS_MAX = 64;
/** `--workers auto` ceiling — beyond ~8 the gains on a typical mock
 *  server are dominated by network/IO contention, not parallelism. */
const WORKERS_AUTO_CEILING = 8;

/**
 * Run `fn` over `items` with at most `workers` in-flight at once.
 *
 * Results are returned in input order, *not* completion order — keep
 * call-sites that compose findings/snapshots deterministic.
 *
 * Errors propagate: the first rejection cancels remaining workers'
 * dispatch (they finish their in-flight task and exit). Caller should
 * `try/catch` if it wants partial results — none of zond's callers do
 * today (a runner crash is fatal anyway).
 */
export async function runPool<T, R>(
  items: readonly T[],
  workers: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  // Effective worker count is clamped both ways: never more than items
  // (idle workers waste a closure), never below 1 (else nothing runs).
  const effective = Math.max(1, Math.min(workers, items.length));
  // Sequential fast-path — preserves the *exact* old behaviour
  // (microtask ordering, error timing) for AC #4 backward-compat.
  if (effective === 1) {
    const out: R[] = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      out[i] = await fn(items[i]!, i);
    }
    return out;
  }
  const out: R[] = new Array(items.length);
  let cursor = 0;
  let aborted: unknown = null;
  async function worker(): Promise<void> {
    while (true) {
      if (aborted !== null) return;
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (err) {
        // First rejection wins — store it, drain in-flight tasks, then
        // re-throw at the join point.
        if (aborted === null) aborted = err;
        return;
      }
    }
  }
  const swarm: Promise<void>[] = [];
  for (let w = 0; w < effective; w++) swarm.push(worker());
  await Promise.all(swarm);
  if (aborted !== null) throw aborted;
  return out;
}

/**
 * Parse a `--workers` flag value:
 *
 *   undefined      → 1 (backward-compat default — AC #4)
 *   "auto" / "AUTO"→ min(cpus, WORKERS_AUTO_CEILING) (AC #5)
 *   numeric        → clamp [1, 64] (AC #5)
 *   anything else  → throws (caller maps to a friendly CLI error)
 */
export function parseWorkers(value: string | number | undefined): number {
  if (value === undefined || value === null || value === "") return 1;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "auto") {
      return Math.max(WORKERS_MIN, Math.min(os.cpus().length, WORKERS_AUTO_CEILING));
    }
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n)) throw new Error(`Invalid --workers value: "${value}"`);
    return Math.max(WORKERS_MIN, Math.min(n, WORKERS_MAX));
  }
  if (!Number.isFinite(value)) throw new Error(`Invalid --workers value: ${value}`);
  return Math.max(WORKERS_MIN, Math.min(Math.trunc(value), WORKERS_MAX));
}

export const WORKERS_LIMITS = {
  min: WORKERS_MIN,
  max: WORKERS_MAX,
  autoCeiling: WORKERS_AUTO_CEILING,
} as const;
