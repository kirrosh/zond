/**
 * Default `triage/` path for `--output` (TASK-163, m-9 P7).
 *
 * Rule: when the user runs a report-emitting command without `--output`,
 * we drop the artifact into:
 *
 *     <workspace>/triage/<api|"adhoc">/<run-id>/<command>-<timestamp>.<ext>
 *
 * If they pass `--output some-filename.md` (no slash), that filename is
 * used as the basename inside the same directory. An `--output` that
 * includes a directory component is honoured verbatim.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { findWorkspaceRoot } from "./root.ts";

export interface TriageOpts {
  /** Logical command name — used in the auto-filename. */
  command: string;
  /** Run id (or undefined for ad-hoc artifacts). */
  runId?: number | null;
  /** API/collection name; falls back to `"adhoc"` when not known. */
  api?: string | null;
  /** Default extension (md / html / json). Without a leading dot. */
  ext: string;
  /** What the user typed in --output (may be undefined). */
  userOutput?: string;
  /** Optional explicit timestamp for tests. */
  now?: Date;
}

export interface ResolvedTriagePath {
  /** Absolute path to write. */
  absolute: string;
  /** Workspace-relative path for prettier console output. */
  relative: string;
  /** True when we landed under triage/ vs. honoured the user path. */
  underTriage: boolean;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function timestamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function resolveTriageOutput(opts: TriageOpts): ResolvedTriagePath {
  const ws = findWorkspaceRoot();
  const root = ws.root;
  const ext = opts.ext.replace(/^\./, "");
  const ts = timestamp(opts.now ?? new Date());
  const apiSlug = opts.api ?? "adhoc";
  const runSlug = opts.runId != null ? `run-${opts.runId}` : "adhoc";

  // 1) User passed a path with a directory component → honour verbatim.
  if (opts.userOutput && /[\\/]/.test(opts.userOutput)) {
    const abs = isAbsolute(opts.userOutput) ? opts.userOutput : resolve(opts.userOutput);
    mkdirSync(dirname(abs), { recursive: true });
    return {
      absolute: abs,
      relative: relPath(abs, root),
      underTriage: false,
    };
  }

  // 2) Default location.
  const dir = join(root, "triage", apiSlug, runSlug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const basename = opts.userOutput ?? `${opts.command}-${ts}.${ext}`;
  const abs = join(dir, basename);
  return {
    absolute: abs,
    relative: relPath(abs, root),
    underTriage: true,
  };
}

function relPath(abs: string, root: string): string {
  if (abs.startsWith(root)) {
    const r = abs.slice(root.length).replace(/^[\\/]+/, "");
    return r.replace(/\\/g, "/");
  }
  return abs;
}
