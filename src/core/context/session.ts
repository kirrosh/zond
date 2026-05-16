import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findWorkspaceRoot } from "../workspace/root.ts";

const SESSION_DIR = ".zond";
const SESSION_FILE = "current-session";

export interface SessionRecord {
  id: string;
  label?: string;
  started_at: string;
}

export function sessionFilePath(cwd?: string): string {
  const base = cwd ?? findWorkspaceRoot().root;
  return join(base, SESSION_DIR, SESSION_FILE);
}

export function readCurrentSession(cwd?: string): SessionRecord | null {
  const path = sessionFilePath(cwd);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SessionRecord>;
    if (typeof parsed.id !== "string" || parsed.id.length === 0) return null;
    return {
      id: parsed.id,
      label: typeof parsed.label === "string" ? parsed.label : undefined,
      started_at: typeof parsed.started_at === "string" ? parsed.started_at : new Date().toISOString(),
    };
  } catch {
    // legacy / hand-edited single-line UUID
    return { id: raw, started_at: new Date().toISOString() };
  }
}

export function writeCurrentSession(record: SessionRecord, cwd?: string): string {
  const path = sessionFilePath(cwd);
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  else {
    const st = statSync(dir);
    if (!st.isDirectory()) {
      throw new Error(`${dir} exists and is not a directory; remove it before running 'zond session start'`);
    }
  }
  writeFileSync(path, JSON.stringify(record) + "\n", "utf-8");
  return path;
}

export function clearCurrentSession(cwd?: string): boolean {
  const path = sessionFilePath(cwd);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Resolution order for the session_id used by `zond run`:
 *   1. explicit --session-id flag
 *   2. ZOND_SESSION_ID env var
 *   3. .zond/current-session file (written by `zond session start`)
 *
 * Returns null when none of the three is set.
 */
export function resolveSessionId(opts: {
  flag?: string | null;
  env?: string | null;
  cwd?: string;
}): string | null {
  const flag = opts.flag?.trim();
  if (flag) return flag;
  const env = opts.env?.trim();
  if (env) return env;
  const record = readCurrentSession(opts.cwd);
  return record?.id ?? null;
}
