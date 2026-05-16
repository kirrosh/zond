import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TestRunResult, AssertionResult, StepResult } from "./types.ts";

export interface DriftCase {
  suite_name: string;
  suite_file?: string;
  step_name: string;
  method?: string;
  path?: string;
  expected: number;
  observed: number;
  schema_validated: boolean;
}

/**
 * Detect status-code drift cases: step would have passed if `expect.status`
 * matched the observed status, every body/header assertion is green, and the
 * response body matches the OpenAPI schema (no `kind: schema` failures).
 *
 * Skipped on purpose:
 *  - `error` steps (network/transport — not a drift signal)
 *  - `expect.status` arrays (`one of [...]`) — drift only triggers on a single
 *    expected value; arrays already encode tolerance
 *  - steps without `kind: schema` evidence — treated as drift_without_schema
 *    and surfaced separately to the caller via `schema_validated: false`
 */
export interface DetectOptions {
  /** True when the run was launched with a schema validator attached. The
   *  validator produces no assertions on success, so step.assertions alone
   *  can't distinguish "schema ok" from "no validator". */
  schemaValidatorAttached: boolean;
}

export function detectStatusDrifts(results: TestRunResult[], opts: DetectOptions = { schemaValidatorAttached: false }): DriftCase[] {
  const cases: DriftCase[] = [];
  for (const r of results) {
    for (const step of r.steps) {
      const drift = classifyStep(step, opts);
      if (!drift) continue;
      cases.push({
        suite_name: r.suite_name,
        suite_file: r.suite_file,
        step_name: step.name,
        method: step.request?.method,
        path: extractPathFromUrl(step.request?.url),
        expected: drift.expected,
        observed: drift.observed,
        schema_validated: drift.schemaValidated,
      });
    }
  }
  return cases;
}

interface StepDrift {
  expected: number;
  observed: number;
  schemaValidated: boolean;
}

function classifyStep(step: StepResult, opts: DetectOptions): StepDrift | null {
  if (step.status !== "fail") return null;
  if (!step.response) return null;

  const statusFails = step.assertions.filter(
    a => a.field === "status" && !a.passed && typeof a.rule === "string" && a.rule.startsWith("equals "),
  );
  if (statusFails.length !== 1) return null;

  const otherFails = step.assertions.filter(a => !a.passed && a !== statusFails[0]);
  if (otherFails.length > 0) return null;

  const expected = parseExpected(statusFails[0]!);
  if (expected === null) return null;

  const observed = step.response.status;
  if (expected === observed) return null;

  // Schema validation evidence — when the validator was attached, assertions
  // contain `kind: "schema"` entries on failure and nothing on success. So
  // "validator attached AND no failing schema assertion" is the success case.
  const schemaFails = step.assertions.filter(a => a.kind === "schema" && !a.passed);
  if (schemaFails.length > 0) return null; // body diverges from spec — not a drift
  const schemaValidated = opts.schemaValidatorAttached;

  return { expected, observed, schemaValidated };
}

function parseExpected(a: AssertionResult): number | null {
  if (typeof a.expected === "number") return a.expected;
  if (typeof a.expected === "string") {
    const n = Number(a.expected);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractPathFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function formatDriftPlan(cases: DriftCase[]): string {
  if (cases.length === 0) return "No status-code drift detected.\n";
  const lines: string[] = [];
  lines.push(`Drift detected (${cases.length} case${cases.length === 1 ? "" : "s"}):`);
  for (const c of cases) {
    const ep = `${c.method ?? "?"} ${c.path ?? "?"}`.padEnd(40);
    const schema = c.schema_validated ? "body-schema=ok" : "body-schema=unverified";
    lines.push(`  ${ep} spec=${c.expected}  observed=${c.observed}  ${schema}  → suggest: update test, or add to drifts`);
  }
  lines.push("");
  lines.push("Run with --learn-apply --learn-target=test     to rewrite expect.status in YAML");
  lines.push("Run with --learn-apply --learn-target=drifts   to record in apis/<name>/tolerated-drifts.yaml");
  return lines.join("\n") + "\n";
}

export interface ApplyResult {
  updated: number;
  errors: { suite_file: string; step_name: string; reason: string }[];
}

/**
 * Rewrite `expect.status: <expected>` → `<observed>` in each suite file.
 *
 * Implementation is line-based: locate the step block by `name:`, then scan
 * forward until the next sibling step or dedent looking for the first
 * `status:` line at a deeper indent. We don't reparse the YAML — preserves
 * comments, key order, and trailing whitespace so the diff is minimal.
 */
export async function applyDriftsToTests(cases: DriftCase[]): Promise<ApplyResult> {
  const result: ApplyResult = { updated: 0, errors: [] };

  // Group by file — read once, write once per file.
  const byFile = new Map<string, DriftCase[]>();
  for (const c of cases) {
    if (!c.suite_file) {
      result.errors.push({ suite_file: "<unknown>", step_name: c.step_name, reason: "suite_file missing" });
      continue;
    }
    const list = byFile.get(c.suite_file) ?? [];
    list.push(c);
    byFile.set(c.suite_file, list);
  }

  for (const [file, fileCases] of byFile) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch (err) {
      for (const c of fileCases) {
        result.errors.push({ suite_file: file, step_name: c.step_name, reason: `read failed: ${(err as Error).message}` });
      }
      continue;
    }

    let lines = content.split("\n");
    let touched = false;
    for (const c of fileCases) {
      const edited = rewriteExpectStatus(lines, c.step_name, c.expected, c.observed);
      if (edited.ok) {
        lines = edited.lines;
        touched = true;
        result.updated++;
      } else {
        result.errors.push({ suite_file: file, step_name: c.step_name, reason: edited.reason });
      }
    }

    if (touched) {
      try {
        await writeFile(file, lines.join("\n"), "utf-8");
      } catch (err) {
        for (const c of fileCases) {
          result.errors.push({ suite_file: file, step_name: c.step_name, reason: `write failed: ${(err as Error).message}` });
        }
      }
    }
  }

  return result;
}

function rewriteExpectStatus(
  lines: string[],
  stepName: string,
  expected: number,
  observed: number,
): { ok: true; lines: string[] } | { ok: false; reason: string } {
  // Match `- name: foo` or `- name: "foo"` — capture indent of the dash so we
  // know where the step block ends.
  const nameRe = new RegExp(`^(\\s*)-\\s+name:\\s+["']?${escapeRegExp(stepName)}["']?\\s*$`);
  let stepStart = -1;
  let stepIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(nameRe);
    if (m) {
      stepStart = i;
      stepIndent = m[1]!.length;
      break;
    }
  }
  if (stepStart < 0) return { ok: false, reason: `step "${stepName}" not found in YAML` };

  // Step block ends at next sibling (`- name:` at the same indent) or at the
  // first line that dedents past the step's column.
  let stepEnd = lines.length;
  for (let i = stepStart + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const indent = line.match(/^(\s*)/)![1]!.length;
    if (indent <= stepIndent) {
      stepEnd = i;
      break;
    }
  }

  const statusRe = new RegExp(`^(\\s*)status:\\s*${expected}\\s*(#.*)?$`);
  for (let i = stepStart + 1; i < stepEnd; i++) {
    const m = lines[i]!.match(statusRe);
    if (m) {
      const tail = m[2] ? ` ${m[2]}` : "";
      lines[i] = `${m[1]}status: ${observed}${tail}`;
      return { ok: true, lines };
    }
  }
  return { ok: false, reason: `expect.status: ${expected} not found within step "${stepName}"` };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Append drift cases to `<apiDir>/tolerated-drifts.yaml`. The file is a flat
 * `drifts:` list; we de-duplicate on (method, path, expected, observed).
 *
 * Format kept intentionally minimal — runner-side enforcement (skip the
 * status assertion when a tolerated drift matches) is a follow-up task; this
 * call just records the data so a human can review.
 */
export async function appendToleratedDrifts(apiDir: string, cases: DriftCase[]): Promise<{ written: number; file: string }> {
  const file = `${apiDir}/tolerated-drifts.yaml`;
  let existing = "";
  try {
    existing = await readFile(file, "utf-8");
  } catch {
    // new file — keep empty
  }

  const seen = new Set<string>();
  const driftRe = /^\s*-\s*method:\s*(\w+)\s*$\n\s*path:\s*(\S+)\s*$\n\s*expected:\s*(\d+)\s*$\n\s*observed:\s*(\d+)/gm;
  let m: RegExpExecArray | null;
  while ((m = driftRe.exec(existing)) !== null) {
    seen.add(`${m[1]!.toUpperCase()} ${m[2]} ${m[3]}->${m[4]}`);
  }

  const fresh: DriftCase[] = [];
  for (const c of cases) {
    const key = `${(c.method ?? "?").toUpperCase()} ${c.path ?? "?"} ${c.expected}->${c.observed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(c);
  }

  if (fresh.length === 0) return { written: 0, file };

  let body = existing;
  if (!/^drifts:\s*$/m.test(body)) {
    body = body.trim();
    if (body.length > 0) body += "\n";
    body += "drifts:\n";
  } else if (!body.endsWith("\n")) {
    body += "\n";
  }

  for (const c of fresh) {
    body += `  - method: ${c.method ?? "?"}\n`;
    body += `    path: ${c.path ?? "?"}\n`;
    body += `    expected: ${c.expected}\n`;
    body += `    observed: ${c.observed}\n`;
    body += `    note: ""\n`;
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, "utf-8");
  return { written: fresh.length, file };
}
