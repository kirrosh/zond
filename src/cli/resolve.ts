/**
 * Shared helpers for command-action callbacks: resolving the active API
 * collection, the spec argument that spec-consuming commands accept, and
 * tiny utilities (`globalJson`, deprecation warning). Extracted from
 * program.ts (TASK-190 round 2a) so per-command modules can register
 * themselves without re-importing program.ts.
 */

import type { Command } from "commander";
import { getDb } from "../db/schema.ts";
import { findCollectionByNameOrId } from "../db/queries.ts";
import { resolveCollectionSpec } from "../core/setup-api.ts";
import { readCurrentApi } from "../core/context/current.ts";

/**
 * TASK-73: `--json` is a per-command option (not a top-level global) so
 * that `run --json` does not collide with `run --report json`.
 * Subcommands that support an envelope output add `.option("--json", ...)`
 * themselves and we read it from local opts.
 */
export function globalJson(cmd: Command): boolean {
  return cmd.opts().json === true;
}

/** Resolve API collection → returns { spec?, testPath?, baseDir? } or { error } when not found. */
export function resolveApiCollection(apiName: string, dbPath: string | undefined):
  | { spec: string | null; testPath: string | null; baseDir: string | null }
  | { error: string } {
  if (typeof apiName !== "string" || apiName.length === 0) {
    return { error: "Internal: --api received non-string value" };
  }
  try {
    getDb(dbPath);
    const col = findCollectionByNameOrId(apiName);
    if (!col) return { error: `API '${apiName}' not found` };
    const spec = col.openapi_spec ? resolveCollectionSpec(col.openapi_spec) : null;
    return { spec, testPath: col.test_path ?? null, baseDir: col.base_dir ?? null };
  } catch (err) {
    return { error: `Failed to resolve --api: ${(err as Error).message}` };
  }
}

/**
 * Resolve `apis/<name>/.env.yaml` for a registered API. TASK-233: probe
 * subcommands required `--env <file>` even when `--api <name>` was given,
 * forcing users to repeat the path. When --api is set we derive the env
 * file from the collection's base_dir; only error if the file is missing.
 *
 * Returns the absolute path to the env file when it exists, otherwise an
 * error object. Callers may also fall back to other strategies on miss.
 */
export function resolveApiEnv(apiName: string, dbPath: string | undefined):
  | { env: string }
  | { error: string } {
  const col = resolveApiCollection(apiName, dbPath);
  if ("error" in col) return col;
  if (!col.baseDir) {
    return { error: `API '${apiName}' has no base_dir registered — pass --env <file> explicitly.` };
  }
  const envPath = `${col.baseDir.replace(/\/+$/, "")}/.env.yaml`;
  return { env: envPath };
}

/**
 * Resolve a `<spec>` argument used by spec-consuming commands —
 * catalog, sync, generate, probe-validation, probe-methods,
 * probe-mass-assignment, lint-spec, describe, guide.
 *
 * Resolution order:
 *   1. Explicit positional/flag value — used as-is (URL or filesystem path).
 *   2. --api <name> — look up the workspace-local snapshot via
 *      `resolveCollectionSpec`.
 *   3. .zond-current — same lookup using the currently-selected API.
 *
 * Returns `{ spec }` on success, `{ error }` on failure. Centralised here
 * so commands stay thin and skill/CI prompts can rely on either form.
 */
export function resolveSpecArg(
  positional: string | undefined,
  apiFlag: string | undefined,
  dbPath: string | undefined,
): { spec: string } | { error: string } {
  if (typeof positional === "string" && positional.length > 0) {
    return { spec: positional };
  }
  const apiName = apiFlag ?? readCurrentApi() ?? undefined;
  if (!apiName) {
    return {
      error: "Need a spec — pass it positionally, via --api <name>, or set the current API with `zond use <name>`.",
    };
  }
  const resolved = resolveApiCollection(apiName, dbPath);
  if ("error" in resolved) return { error: resolved.error };
  if (!resolved.spec) {
    return {
      error:
        `API '${apiName}' is registered without an OpenAPI spec — this command needs one. ` +
        `Run \`zond refresh-api ${apiName} --spec <path|url>\` to attach a spec, ` +
        `or use \`zond run --api ${apiName} <test.yaml>\` for YAML-based testing.`,
    };
  }
  return { spec: resolved.spec };
}

