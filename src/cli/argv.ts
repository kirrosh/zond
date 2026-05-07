/**
 * Pre-commander argv handling and shared argument parsers used across the
 * commander tree. Pulled out of program.ts (TASK-190, m-11) so program.ts
 * shrinks toward "just command registration" and these helpers can be
 * unit-tested in isolation.
 */

import { InvalidArgumentError } from "commander";
import type { ReporterName } from "../core/reporter/types.ts";

// ── MSYS path preprocessing ──
//
// Git Bash on Windows converts API paths like "/users" → "C:/Program Files/Git/users".
// We reverse that for flags whose values are API paths, not filesystem paths.

const MSYS_PREFIX_RE = /^[A-Z]:[\\/](?:Program Files[\\/]Git|msys64|usr)[\\/]/i;

const API_PATH_FLAGS = new Set(["--path", "--json-path"]);

function stripMsysPath(value: string): string {
  if (!MSYS_PREFIX_RE.test(value)) return value;
  return value.replace(MSYS_PREFIX_RE, "/");
}

/**
 * Pre-process argv before commander sees it: undo Git Bash's MSYS path conversion
 * for `--path` and `--json-path` values (both `--path X` and `--path=X` forms).
 */
export function preprocessArgv(argv: string[]): string[] {
  const out = [...argv];
  for (let i = 0; i < out.length; i++) {
    const arg = out[i]!;

    // --flag=value form
    const eqIdx = arg.indexOf("=");
    if (arg.startsWith("--") && eqIdx !== -1) {
      const flag = arg.slice(0, eqIdx);
      if (API_PATH_FLAGS.has(flag)) {
        out[i] = `${flag}=${stripMsysPath(arg.slice(eqIdx + 1))}`;
      }
      continue;
    }

    // --flag value form
    if (API_PATH_FLAGS.has(arg)) {
      const next = out[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out[i + 1] = stripMsysPath(next);
      }
    }
  }
  return out;
}

// ── Argument parsers ──

export function parsePositiveInt(name: string): (raw: string) => number {
  return (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) {
      throw new InvalidArgumentError(`Invalid ${name} value: ${raw}`);
    }
    return n;
  };
}

/** `--rate-limit` accepts a positive integer (req/sec cap) or the literal
 *  string `auto` (no static cap; throttle adaptively from ratelimit-* headers). */
export function parseRateLimit(raw: string): number | "auto" {
  if (raw.toLowerCase() === "auto") return "auto";
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new InvalidArgumentError(`Invalid --rate-limit value: ${raw} (expected a positive integer or "auto")`);
  }
  return n;
}

export function parseInteger(name: string): (raw: string) => number {
  return (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) {
      throw new InvalidArgumentError(`Invalid ${name} value: ${raw}`);
    }
    return n;
  };
}

export function parsePercentage(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 100) {
    throw new InvalidArgumentError(`Invalid --fail-on-coverage value: ${raw} (must be 0–100)`);
  }
  return n;
}

export const collect = (val: string, prev: string[]): string[] => [...prev, val];

const VALID_REPORTERS = new Set<string>(["console", "json", "junit"]);

export function parseReporter(raw: string): ReporterName {
  if (!VALID_REPORTERS.has(raw)) {
    throw new InvalidArgumentError(`Unknown reporter: ${raw}. Available: console, json, junit`);
  }
  return raw as ReporterName;
}

/** Helper: split repeatable values like ["a,b", "c"] → ["a", "b", "c"] */
export function flatSplit(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const out = values.flatMap((v) => v.split(",")).filter(Boolean);
  return out.length > 0 ? out : undefined;
}
