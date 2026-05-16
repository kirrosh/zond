/**
 * Workspace `zond.config.yml` loader (TASK-301).
 *
 * Centralises read-only access to workspace-level defaults. Right now only
 * two fields are honoured:
 *
 *   defaults:
 *     timeout_ms: 30000   # used by cleanup / prepare-fixtures / probe
 *                         # mass-assignment / probe security / request
 *     rate_limit: 5       # used by `zond run` (number, or "auto")
 *
 * Resolution chain across the CLI (highest wins):
 *
 *   CLI flag → per-API .env.yaml meta → workspace defaults → hard-coded fallback
 *
 * Per-API overrides live in `apis/<name>/.env.yaml` as `rateLimit:` /
 * `timeoutMs:` (see `loadEnvMeta`); we deliberately don't carve a second
 * channel into this file to avoid two ways of saying the same thing.
 *
 * Read-once-and-cache: the file is parsed at most once per process from
 * the workspace root resolved by `findWorkspaceRoot`. Tests can call
 * `_resetWorkspaceConfigCache()` between runs.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "./root.ts";

export interface WorkspaceDefaults {
  /** Per-request timeout in ms applied when the CLI flag and `.env.yaml` are silent. */
  timeoutMs?: number;
  /** Run-time rate limit (rps) or `"auto"`. */
  rateLimit?: number | "auto";
}

let cache: { root: string; defaults: WorkspaceDefaults } | null = null;

function parseTimeoutMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function parseRateLimit(v: unknown): number | "auto" | undefined {
  if (v === "auto") return "auto";
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    if (v === "auto") return "auto";
    const n = Number.parseFloat(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function readDefaults(configPath: string): WorkspaceDefaults {
  if (!existsSync(configPath)) return {};
  let parsed: unknown;
  try {
    const text = readFileSync(configPath, "utf8");
    parsed = Bun.YAML.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;
  const defaultsRaw = obj.defaults;
  if (typeof defaultsRaw !== "object" || defaultsRaw === null || Array.isArray(defaultsRaw)) return {};
  const d = defaultsRaw as Record<string, unknown>;
  const out: WorkspaceDefaults = {};
  const t = parseTimeoutMs(d.timeout_ms ?? d.timeoutMs);
  if (t !== undefined) out.timeoutMs = t;
  const r = parseRateLimit(d.rate_limit ?? d.rateLimit);
  if (r !== undefined) out.rateLimit = r;
  return out;
}

/**
 * Returns the workspace defaults block, cached for the lifetime of the
 * process. When no workspace marker is found, returns `{}` (no defaults).
 */
export function loadWorkspaceDefaults(cwd?: string): WorkspaceDefaults {
  const ws = findWorkspaceRoot(cwd);
  if (ws.fromFallback) return {};
  if (cache && cache.root === ws.root) return cache.defaults;
  const defaults = readDefaults(join(ws.root, "zond.config.yml"));
  cache = { root: ws.root, defaults };
  return defaults;
}

/** Test helper: drop the parse cache so the next call re-reads from disk. */
export function _resetWorkspaceConfigCache(): void {
  cache = null;
}

export const HARD_DEFAULT_TIMEOUT_MS = 30000;

/**
 * Resolve `--timeout` via CLI > per-API `.env.yaml` (`timeoutMs`) > workspace
 * `defaults.timeout_ms` > 30000. Each layer accepts `undefined` to mean
 * "fall through".
 */
export function resolveTimeoutMs(
  cliFlag: number | undefined,
  envMetaTimeout: number | undefined,
  cwd?: string,
): number {
  if (cliFlag !== undefined) return cliFlag;
  if (envMetaTimeout !== undefined) return envMetaTimeout;
  const ws = loadWorkspaceDefaults(cwd);
  return ws.timeoutMs ?? HARD_DEFAULT_TIMEOUT_MS;
}

/**
 * Resolve `--rate-limit` via CLI > per-API `.env.yaml` (`rateLimit`) >
 * workspace `defaults.rate_limit` > undefined (no throttling).
 */
export function resolveRateLimit(
  cliFlag: number | "auto" | undefined,
  envMetaRateLimit: number | "auto" | undefined,
  cwd?: string,
): number | "auto" | undefined {
  if (cliFlag !== undefined) return cliFlag;
  if (envMetaRateLimit !== undefined) return envMetaRateLimit;
  const ws = loadWorkspaceDefaults(cwd);
  return ws.rateLimit;
}
