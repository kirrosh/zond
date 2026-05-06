/**
 * Auto-rotate `--output <path>` targets so a second `zond report ...` (or
 * `zond probe-* --output ...`) does not silently clobber the previous
 * artifact (TASK-162, m-9 P6).
 *
 * Strategy: when `path` already exists, rename it to `<basename>-vN<ext>`
 * with the smallest free N (≥ 2) and return that rotation info so the
 * caller can print it. The `--overwrite` flag short-circuits to no-op so
 * users keep the previous behaviour when they explicitly ask for it.
 */

import { existsSync, renameSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

export interface RotationResult {
  /** The path that was renamed (the old artifact). undefined when no rotation happened. */
  rotatedFrom?: string;
  /** Where the old artifact moved to. undefined when no rotation happened. */
  rotatedTo?: string;
  /** True when caller asked for `--overwrite` (or the target didn't exist). */
  overwrite: boolean;
}

export interface RotateOptions {
  /** When true, skip rotation entirely (overwrite-in-place). */
  overwrite?: boolean;
  /** Optional callback for the human-facing notice; defaults to stderr. */
  notice?: (msg: string) => void;
}

/**
 * Rename `targetPath` to `<base>-vN<ext>` if it exists and `--overwrite`
 * is not set. Returns rotation info; the caller is responsible for
 * actually writing the new artifact at `targetPath`.
 */
export function rotateOutputTarget(targetPath: string, opts: RotateOptions = {}): RotationResult {
  if (opts.overwrite) return { overwrite: true };
  if (!existsSync(targetPath)) return { overwrite: false };

  const dir = dirname(targetPath);
  const ext = extname(targetPath);
  const stem = basename(targetPath, ext);
  // Strip an existing `-vN` suffix from the stem so successive rotations
  // produce `digest-v2.md`, `digest-v3.md` rather than
  // `digest-v2-v2.md` etc.
  const stemBare = stem.replace(/-v\d+$/, "");

  let n = 2;
  while (n < 1000) {
    const candidate = join(dir, `${stemBare}-v${n}${ext}`);
    if (!existsSync(candidate)) {
      renameSync(targetPath, candidate);
      const notice = opts.notice ?? ((m: string) => process.stderr.write(m + "\n"));
      notice(`Previous artifact moved to ${candidate}`);
      return { rotatedFrom: targetPath, rotatedTo: candidate, overwrite: false };
    }
    n++;
  }
  // Pathological: 1000 versions exist. Fall back to overwrite to avoid
  // an infinite-loop UX failure.
  return { overwrite: true };
}
