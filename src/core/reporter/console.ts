import type { TestRunResult, StepResult, AssertionResult } from "../runner/types.ts";
import type { Reporter, ReporterOptions } from "./types.ts";

// ANSI escape codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const YELLOW = "\x1b[33m";

const PASS_ICON = "\u2713"; // ✓
const FAIL_ICON = "\u2717"; // ✗
const SKIP_ICON = "\u25CB"; // ○

export function is5xx(step: StepResult): boolean {
  const status = step.response?.status;
  return typeof status === "number" && status >= 500 && status < 600;
}

export function count5xx(steps: StepResult[]): number {
  let n = 0;
  for (const s of steps) {
    if ((s.status === "fail" || s.status === "error") && is5xx(s)) n++;
  }
  return n;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function formatStep(step: StepResult, color: boolean): string {
  const duration = formatDuration(step.duration_ms);

  switch (step.status) {
    case "pass": {
      const icon = color ? `${GREEN}${PASS_ICON}${RESET}` : PASS_ICON;
      const dim = color ? `${DIM}(${duration})${RESET}` : `(${duration})`;
      return `  ${icon} ${step.name} ${dim}`;
    }
    case "fail": {
      const icon = color ? `${RED}${FAIL_ICON}${RESET}` : FAIL_ICON;
      const dim = color ? `${DIM}(${duration})${RESET}` : `(${duration})`;
      const tag = is5xx(step) ? (color ? ` ${BOLD}${YELLOW}[5xx ${step.response?.status}]${RESET}` : ` [5xx ${step.response?.status}]`) : "";
      return `  ${icon} ${step.name}${tag} ${dim}`;
    }
    case "skip": {
      const icon = color ? `${GRAY}${SKIP_ICON}${RESET}` : SKIP_ICON;
      const reason = step.error ? `skipped: ${step.error}` : "skipped";
      const label = color ? `${GRAY}(${reason})${RESET}` : `(${reason})`;
      return `  ${icon} ${step.name} ${label}`;
    }
    case "error": {
      const icon = color ? `${RED}${FAIL_ICON}${RESET}` : FAIL_ICON;
      const label = color ? `${DIM}(error)${RESET}` : "(error)";
      return `  ${icon} ${step.name} ${label}`;
    }
  }
}

export function formatFailures(step: StepResult, color: boolean): string {
  const lines: string[] = [];

  if (step.status === "error" && step.error) {
    const msg = color ? `${RED}Error: ${step.error}${RESET}` : `Error: ${step.error}`;
    lines.push(`    ${msg}`);
    return lines.join("\n");
  }

  const failed = step.assertions.filter((a) => !a.passed);
  for (const a of failed) {
    const msg = `${a.field}: expected ${a.rule} but got ${formatValue(a.actual)}`;
    lines.push(color ? `    ${RED}${msg}${RESET}` : `    ${msg}`);
  }
  return lines.join("\n");
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

export function formatSuiteResult(result: TestRunResult, color: boolean): string {
  const lines: string[] = [];

  // Suite header
  const header = color ? ` ${BOLD}${result.suite_name}${RESET}` : ` ${result.suite_name}`;
  lines.push(header);

  // Tags
  if (result.suite_tags?.length) {
    const tagsStr = result.suite_tags.map(t => `[${t}]`).join(" ");
    lines.push(color ? `  ${DIM}${tagsStr}${RESET}` : `  ${tagsStr}`);
  }

  // Steps
  for (const step of result.steps) {
    lines.push(formatStep(step, color));
    if (step.status === "fail" || step.status === "error") {
      const details = formatFailures(step, color);
      if (details) lines.push(details);
    }
  }

  // Summary
  const totalMs = Date.parse(result.finished_at) - Date.parse(result.started_at);
  const duration = formatDuration(totalMs > 0 ? totalMs : 0);
  const parts: string[] = [];

  if (result.passed > 0) {
    parts.push(color ? `${GREEN}${result.passed} passed${RESET}` : `${result.passed} passed`);
  }
  if (result.failed > 0) {
    parts.push(color ? `${RED}${result.failed} failed${RESET}` : `${result.failed} failed`);
  }
  const fiveXx = count5xx(result.steps);
  if (fiveXx > 0) {
    const label = `${fiveXx} 5xx`;
    parts.push(color ? `${BOLD}${YELLOW}${label}${RESET}` : label);
  }
  if (result.skipped > 0) {
    parts.push(color ? `${GRAY}${result.skipped} skipped${RESET}` : `${result.skipped} skipped`);
  }
  if (parts.length === 0) {
    parts.push("0 tests");
  }

  lines.push("");
  lines.push(`Results: ${parts.join(", ")} (${duration})`);

  return lines.join("\n");
}

export function formatGrandTotal(results: TestRunResult[], color: boolean): string {
  const totals = { passed: 0, failed: 0, skipped: 0, total: 0, fiveXx: 0 };
  let minStart = Infinity;
  let maxEnd = -Infinity;

  for (const r of results) {
    totals.passed += r.passed;
    totals.failed += r.failed;
    totals.skipped += r.skipped;
    totals.total += r.total;
    totals.fiveXx += count5xx(r.steps);
    const start = Date.parse(r.started_at);
    const end = Date.parse(r.finished_at);
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }

  const totalMs = maxEnd - minStart;
  const duration = formatDuration(totalMs > 0 ? totalMs : 0);
  const parts: string[] = [];

  if (totals.passed > 0) {
    parts.push(color ? `${GREEN}${totals.passed} passed${RESET}` : `${totals.passed} passed`);
  }
  if (totals.failed > 0) {
    parts.push(color ? `${RED}${totals.failed} failed${RESET}` : `${totals.failed} failed`);
  }
  if (totals.fiveXx > 0) {
    const label = `${totals.fiveXx} 5xx`;
    parts.push(color ? `${BOLD}${YELLOW}${label}${RESET}` : label);
  }
  if (totals.skipped > 0) {
    parts.push(color ? `${GRAY}${totals.skipped} skipped${RESET}` : `${totals.skipped} skipped`);
  }

  const header = color ? `${BOLD}Total:${RESET}` : "Total:";
  return `${header} ${parts.join(", ")} (${duration})`;
}

export const consoleReporter: Reporter = {
  report(results: TestRunResult[], options?: ReporterOptions): void {
    const color = options?.color ?? (process.stdout.isTTY ?? false);

    if (results.length === 0) {
      console.log("No test suites found.");
      return;
    }

    const blocks: string[] = [];
    for (const result of results) {
      blocks.push(formatSuiteResult(result, color));
    }

    console.log(blocks.join("\n\n"));

    if (results.length > 1) {
      console.log("\n" + formatGrandTotal(results, color));
    }
  },
};
