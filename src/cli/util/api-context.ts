/**
 * ARV-53: single resolver for the active `--api` collection name.
 *
 * Before this module the chain `localOpts.api → cmd.parent?.opts().api →
 * readCurrentApi()` was inlined in nine call-sites (probe / prepare-fixtures
 * / audit / checks / coverage / run / request, plus two intermediate helpers
 * in probe.ts and resolve.ts). Each repeat was a separate commit
 * (TASK-17, TASK-20, ARV-21, ARV-29, ARV-33). Centralising the chain here
 * means new commands consume one import and the fallback rules live in
 * exactly one place.
 *
 * Resolution order (matches the chain users see documented for `zond use`):
 *   1. Per-command `--api <name>` (the local Commander scope).
 *   2. Any ancestor command's `--api`, walking up to the program root
 *      (covers the global `zond --api X <subcmd>` form whose value is
 *      otherwise stranded on the parent Command).
 *   3. `readCurrentApi()` — which itself folds in
 *      `ZOND_API_GLOBAL` (mirrored by program.ts preAction) →
 *      `ZOND_API` (user env) → `.zond/current-api` (persisted by `zond use`).
 */

import { readCurrentApi } from "../../core/context/current.ts";

/**
 * Minimal shape we need from a Commander `Command`. Spelled out as an
 * interface (not `import("commander").Command`) so test doubles can pass a
 * plain `{ opts, parent }` literal and TS still type-checks.
 */
export interface CommandLike {
  opts(): Record<string, unknown>;
  parent?: CommandLike | null;
}

export type ApiResolution =
  | { ok: true; api: string; source: "local" | "ancestor" | "current" }
  | { ok: false };

/** Pull the explicit --api value out of a command's parsed opts, if any. */
function readApiOpt(cmd: CommandLike): string | undefined {
  const v = cmd.opts().api;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Resolve the active API collection name for `cmd`. Pass `localOpts` when
 * the action handler already has the parsed local opts in hand (avoids a
 * second `cmd.opts()` parse and lets callers tunnel through pre-coerced
 * shapes from tests).
 */
export function resolveApi(
  cmd: CommandLike | undefined,
  localOpts?: Record<string, unknown>,
): ApiResolution {
  const localRaw = localOpts?.api;
  const local = typeof localRaw === "string" && localRaw.trim().length > 0
    ? localRaw.trim()
    : (cmd ? readApiOpt(cmd) : undefined);
  if (local) return { ok: true, api: local, source: "local" };

  let parent: CommandLike | null | undefined = cmd?.parent ?? null;
  while (parent) {
    const fromAncestor = readApiOpt(parent);
    if (fromAncestor) return { ok: true, api: fromAncestor, source: "ancestor" };
    parent = parent.parent ?? null;
  }

  const fromCurrent = readCurrentApi();
  if (fromCurrent) return { ok: true, api: fromCurrent, source: "current" };

  return { ok: false };
}

/**
 * Convenience: returns the API name as `string | undefined`. Use this when
 * the caller decides for itself how to react to "missing" (e.g. `coverage`
 * falls back to `--spec`, `run` falls back to a positional path).
 */
export function getApi(cmd: CommandLike | undefined, localOpts?: Record<string, unknown>): string | undefined {
  const r = resolveApi(cmd, localOpts);
  return r.ok ? r.api : undefined;
}

/** Default error message for commands that strictly require an API. */
export const MISSING_API_MESSAGE =
  "--api is required (or set ZOND_API / `zond use <name>`).";
