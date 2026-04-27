import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

import { claudeSpec } from "./claude.ts";
import { cursorSpec } from "./cursor.ts";
import type { InstallOptions, InstallResult, McpClientSpec } from "./types.ts";

export const CLIENTS: ReadonlyArray<McpClientSpec> = [claudeSpec, cursorSpec];

export function findClient(id: string): McpClientSpec | undefined {
  return CLIENTS.find((c) => c.id === id);
}

/**
 * Detect which clients have a directory under the user's home (e.g. `~/.claude`).
 * Used for the no-flag interactive flow (post-T11) and for `--all` reporting.
 */
export function detectInstalledClients(opts?: InstallOptions): McpClientSpec[] {
  const home = resolveHome(opts);
  return CLIENTS.filter((c) => existsSync(dirname(c.configPath(home))));
}

/**
 * Merge `mcpServers[serverKey] = serverEntry` into the client's MCP config.
 *
 * - File does not exist → create it with `{ mcpServers: { [key]: entry } }`.
 * - File exists, valid JSON → preserve everything else, set the key.
 * - File exists with the same entry → noop.
 * - File exists but unparseable → throw (don't clobber user state).
 */
export function installToClient(spec: McpClientSpec, opts?: InstallOptions): InstallResult {
  const home = resolveHome(opts);
  const path = spec.configPath(home);

  let existing: Record<string, unknown> | null = null;
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8");
    if (raw.trim().length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`Existing config at ${path} is not a JSON object`);
        }
        existing = parsed as Record<string, unknown>;
      } catch (err) {
        if (err instanceof SyntaxError) {
          throw new Error(`Existing config at ${path} is not valid JSON: ${err.message}`);
        }
        throw err;
      }
    }
  }

  const next = { ...(existing ?? {}) };
  const servers = isObject(next.mcpServers) ? { ...next.mcpServers } : {};
  const previousEntry = servers[spec.serverKey];

  servers[spec.serverKey] = spec.serverEntry;
  next.mcpServers = servers;

  const created = existing === null;
  const equal =
    existing !== null &&
    deepEqual(previousEntry, spec.serverEntry) &&
    deepEqual(existing.mcpServers, next.mcpServers);
  const action: InstallResult["action"] = equal ? "noop" : created ? "created" : "updated";

  if (!opts?.dryRun && action !== "noop") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf-8");
  }

  return { client: spec.id, configPath: path, action };
}

/**
 * Resolve the user's home directory, honoring runtime env mutation.
 *
 * `os.homedir()` caches its result on first call, so test suites that mutate
 * `process.env.HOME` mid-process would otherwise see the cached value.
 */
function resolveHome(opts?: InstallOptions): string {
  if (opts?.home) return opts.home;
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    if (typeof b !== "object" || b === null || Array.isArray(b)) return false;
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((k, i) => k === bKeys[i])) return false;
    return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
  }
  return false;
}

export type { InstallOptions, InstallResult, McpClientSpec } from "./types.ts";
