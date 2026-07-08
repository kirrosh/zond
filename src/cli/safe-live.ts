/**
 * ARV-299: one safe/live vocabulary across `audit`, `checks run`, and the
 * mutating `probe` subcommands so a developer has a single button —
 * `--safe` (default) means "no destructive traffic", `--live` opts in.
 *
 * The help strings live here so all three commands read identically
 * (ARV-299 AC#3). `audit` predates this module and keeps its own richer
 * --live text (it gates several stages); the shorter pair here is for
 * checks/probe.
 */

export const SAFE_HELP =
  "Safe mode (DEFAULT): no destructive/mutating traffic — no create/update/delete " +
  "chains, no live attack payloads. Explicit inverse of --live; safe if neither is given.";

export const LIVE_HELP =
  "Opt into destructive/mutating operations (create/update/delete chains, live " +
  "attack payloads) against a real API. Use only against a throwaway/sandbox account.";

/** Resolve the safe/live pair to a single boolean. Default is safe;
 *  `--live` wins if both are somehow passed. */
export function resolveLive(opts: { safe?: boolean; live?: boolean }): boolean {
  return opts.live === true;
}
