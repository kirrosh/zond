import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface WorkspaceHandle {
  /** Always realpathSync'd (macOS /var → /private/var). */
  path: string;
  cleanup: () => void;
}

export interface WorkspaceOptions {
  prefix?: string;
  /** Create one of: "config" → zond.config.yml, "apis" → apis/, or a custom path. */
  marker?: "config" | "apis" | string;
  /** chdir into the new directory; returns the previous cwd via cleanup. */
  chdir?: boolean;
}

export function makeWorkspace(opts: WorkspaceOptions = {}): WorkspaceHandle {
  const prefix = opts.prefix ?? "zond-test-";
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));

  if (opts.marker === "config") {
    writeFileSync(join(path, "zond.config.yml"), "version: 1\n", "utf-8");
  } else if (opts.marker === "apis") {
    mkdirSync(join(path, "apis"));
  } else if (typeof opts.marker === "string") {
    const target = join(path, opts.marker);
    if (opts.marker.endsWith("/")) mkdirSync(target, { recursive: true });
    else writeFileSync(target, "", "utf-8");
  }

  let prevCwd: string | undefined;
  if (opts.chdir) {
    prevCwd = process.cwd();
    process.chdir(path);
  }

  return {
    path,
    cleanup: () => {
      if (prevCwd !== undefined) process.chdir(prevCwd);
      try { rmSync(path, { recursive: true, force: true }); } catch { /* best-effort */ }
    },
  };
}
