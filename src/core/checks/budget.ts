/**
 * `--budget quick|standard|full` (ARV-292): adaptive cap for `zond audit` and
 * `zond checks run`, designed so small-team CI gets a "60-sec gate" by default
 * without having to remember `--max-requests` for huge specs.
 *
 * Tiers:
 *   quick     — 50 req cap, skip stateful (CRUD) checks. ~60-sec wall-clock.
 *   standard  — 500 req cap, all checks (sampling kept as a Phase-B knob).
 *   full      — uncapped, all checks.
 *
 * Omitted `--budget` keeps the legacy uncapped behaviour so existing CI
 * pipelines don't suddenly trip `max-requests-cap-reached`. `--max-requests`
 * always wins over the tier-seeded cap.
 */

export type Budget = "quick" | "standard" | "full";

export const BUDGETS: readonly Budget[] = ["quick", "standard", "full"];

export interface ResolvedBudget {
  maxRequests?: number;
  skipStateful: boolean;
}

interface TierDefaults {
  maxRequests?: number;
  skipStateful: boolean;
}

const TIERS: Record<Budget, TierDefaults> = {
  quick: { maxRequests: 50, skipStateful: true },
  standard: { maxRequests: 500, skipStateful: false },
  full: { skipStateful: false },
};

export function isBudget(value: unknown): value is Budget {
  return typeof value === "string" && (BUDGETS as readonly string[]).includes(value);
}

/** Resolve final budget given an explicit budget tier and an optional
 *  `--max-requests` override. When `--max-requests` is set it always wins,
 *  even if it relaxes a tighter tier cap (e.g. `--budget quick --max-requests
 *  200` → cap=200). Stateful-skip is tier-driven only; pass an explicit
 *  include list via `forceStatefulIfIncluded` to opt back in (e.g. when the
 *  user typed `--check stateful`). */
export function resolveBudget(
  budget: Budget | undefined,
  maxRequestsOverride: number | undefined,
  opts?: { forceStatefulIfIncluded?: boolean },
): ResolvedBudget {
  const tier = budget ? TIERS[budget] : undefined;
  const skipStateful = tier?.skipStateful === true && opts?.forceStatefulIfIncluded !== true;
  const cap = typeof maxRequestsOverride === "number" && maxRequestsOverride > 0
    ? maxRequestsOverride
    : tier?.maxRequests;
  const result: ResolvedBudget = { skipStateful };
  if (cap !== undefined) result.maxRequests = cap;
  return result;
}
