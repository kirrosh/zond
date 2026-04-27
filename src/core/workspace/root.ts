import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Files / directories that mark a workspace root. Order matters — earlier
 * markers win when more than one is present in the same directory.
 *
 *   zond.config.yml — explicit project config (T12)
 *   .zond/          — `zond init --here` subdir convention (T19)
 *   zond.db         — flat layout from `zond init`
 *   apis/           — flat layout (collections directory)
 */
export const WORKSPACE_MARKERS = ["zond.config.yml", ".zond", "zond.db", "apis"] as const;
export type WorkspaceMarker = (typeof WORKSPACE_MARKERS)[number];

export interface WorkspaceInfo {
  /** Absolute path to the workspace root. */
  root: string;
  /** Marker that triggered detection, or "" when fallback (cwd) was used. */
  marker: WorkspaceMarker | "";
  /** True when no marker was found and we fell back to `cwd`. */
  fromFallback: boolean;
}

let warned = false;

function hasMarker(dir: string): WorkspaceMarker | null {
  for (const m of WORKSPACE_MARKERS) {
    const p = join(dir, m);
    if (!existsSync(p)) continue;
    // .zond and apis must be directories; zond.config.yml and zond.db must be files
    try {
      const st = statSync(p);
      if (m === ".zond" || m === "apis") {
        if (st.isDirectory()) return m;
      } else if (st.isFile()) {
        return m;
      }
    } catch {
      /* race / permissions — treat as no marker */
    }
  }
  return null;
}

/**
 * Walk-up from `cwd` (default `process.cwd()`) to the nearest workspace
 * marker. The walk stops at `os.homedir()` to avoid accidentally picking up
 * `~/apis` or `~/zond.db` when the user runs zond from somewhere unrelated.
 *
 * When no marker is found, returns `{ root: cwd, fromFallback: true }` and
 * prints a one-time stderr warning so the user knows zond is operating in
 * cwd-mode.
 */
export function findWorkspaceRoot(cwd?: string): WorkspaceInfo {
  const start = resolve(cwd ?? process.cwd());
  const stop = resolve(homedir());

  let dir = start;
  // Walk strictly while above (or equal to) HOME's length, but include HOME
  // itself as a candidate only when start is inside HOME. If start is outside
  // HOME (e.g. /tmp), walk all the way to "/".
  const insideHome = start === stop || start.startsWith(stop + "/") || start.startsWith(stop + "\\");

  while (true) {
    const marker = hasMarker(dir);
    if (marker) return { root: dir, marker, fromFallback: false };

    const parent = dirname(dir);
    if (parent === dir) break;                 // filesystem root
    if (insideHome && dir === stop) break;     // do not climb past HOME
    dir = parent;
  }

  if (!warned) {
    warned = true;
    process.stderr.write(
      `[zond] no workspace marker found from ${start}; using cwd. ` +
      `Run 'zond init' or create zond.config.yml to anchor the workspace.\n`,
    );
  }
  return { root: start, marker: "", fromFallback: true };
}

/** Resolve `relative` against the workspace root (auto-detected from `cwd`). */
export function resolveWorkspacePath(relative: string, cwd?: string): string {
  return resolve(findWorkspaceRoot(cwd).root, relative);
}

/** Test helper: reset the one-shot warning latch. */
export function _resetWorkspaceWarning(): void {
  warned = false;
}
