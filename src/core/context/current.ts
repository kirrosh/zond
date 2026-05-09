import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findWorkspaceRoot } from "../workspace/root.ts";

/**
 * TASK-290: current-API resolution chain.
 *  - Global --api flag is mirrored into ZOND_API_GLOBAL by program.ts preAction.
 *  - Users can also export ZOND_API in their shell.
 *  - Persisted choice lives in `.zond/current-api` (was `.zond-current`).
 */
const FILENAME = ".zond/current-api";

export function currentApiPath(cwd?: string): string {
  const base = cwd ?? findWorkspaceRoot().root;
  return join(base, FILENAME);
}

/**
 * Returns the active API name. Resolution order:
 *  1. ZOND_API_GLOBAL  (mirrored from `zond --api <name> ...`)
 *  2. ZOND_API         (user env)
 *  3. `.zond/current-api` file (set by `zond use <name>`)
 */
export function readCurrentApi(cwd?: string): string | null {
  const fromGlobalFlag = process.env.ZOND_API_GLOBAL?.trim();
  if (fromGlobalFlag) return fromGlobalFlag;
  const fromEnv = process.env.ZOND_API?.trim();
  if (fromEnv) return fromEnv;
  const path = currentApiPath(cwd);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8").trim();
  return raw.length > 0 ? raw : null;
}

/** Writes the API collection name to `.zond/current-api`. Creates the dir if needed. */
export function writeCurrentApi(name: string, cwd?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("API name cannot be empty");
  const path = currentApiPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, trimmed + "\n", "utf-8");
  return path;
}

/** Deletes `.zond/current-api`. Returns true when a file was removed, false when it did not exist. */
export function clearCurrentApi(cwd?: string): boolean {
  const path = currentApiPath(cwd);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
