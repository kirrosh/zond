/**
 * Global registry of `zond checks`. Built-in checks register themselves
 * on first import (see `checks/index.ts`); `selectChecks` resolves the
 * `--check` / `--exclude-check` filters from the CLI into the active
 * subset for a single run.
 */
import type { Check } from "./types.ts";

const REGISTRY = new Map<string, Check>();

export function registerCheck(check: Check): void {
  if (REGISTRY.has(check.id)) {
    throw new Error(`Check "${check.id}" is already registered`);
  }
  REGISTRY.set(check.id, check);
}

export function getCheck(id: string): Check | undefined {
  return REGISTRY.get(id);
}

export function listChecks(): Check[] {
  return [...REGISTRY.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface SelectOptions {
  include?: string[];
  exclude?: string[];
}

export interface SelectionResult {
  selected: Check[];
  unknown: string[];
}

/**
 * Resolve include/exclude id lists into the active set of checks.
 * Unknown ids are returned separately so the caller can surface them as
 * envelope warnings (and decide whether to fail or continue).
 */
export function selectChecks(opts: SelectOptions = {}): SelectionResult {
  const all = listChecks();
  const knownIds = new Set(all.map(c => c.id));
  const unknown: string[] = [];

  for (const id of [...(opts.include ?? []), ...(opts.exclude ?? [])]) {
    if (!knownIds.has(id)) unknown.push(id);
  }

  let pool = all;
  if (opts.include && opts.include.length > 0) {
    const includeSet = new Set(opts.include);
    pool = pool.filter(c => includeSet.has(c.id));
  }
  if (opts.exclude && opts.exclude.length > 0) {
    const excludeSet = new Set(opts.exclude);
    pool = pool.filter(c => !excludeSet.has(c.id));
  }
  return { selected: pool, unknown };
}

/** Test-only escape hatch — wipes the registry between unit tests. */
export function __resetRegistryForTests(): void {
  REGISTRY.clear();
}

/** Test-only snapshot/restore. Use when a test wants a clean slate but the
 *  rest of the suite still needs the side-effect-registered built-ins
 *  (otherwise wiping the registry leaks across files because the modules
 *  that registered them are already cached and won't re-fire on re-import).
 */
export function __snapshotRegistryForTests(): () => void {
  const saved = new Map(REGISTRY);
  return () => {
    REGISTRY.clear();
    for (const [k, v] of saved) REGISTRY.set(k, v);
  };
}
