import type { Issue, LintStats, Severity } from "./types.ts";
import { severityGlyph, rankSeverity } from "../severity/index.ts";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const useColor = (): boolean => process.stdout.isTTY === true;

const ICON: Record<Severity, string> = {
  critical: "🚨", high: "🔴", medium: "⚠️ ", low: "ℹ️ ", info: "· ",
};
const COLOR: Record<Severity, string> = {
  critical: RED, high: RED, medium: YELLOW, low: DIM, info: DIM,
};

export function formatHuman(issues: Issue[], stats: LintStats): string {
  if (issues.length === 0) {
    return useColor() ? `${BOLD}✓ no issues${RESET}\n` : "✓ no issues\n";
  }
  const groups: Record<Severity, Issue[]> = {
    critical: [], high: [], medium: [], low: [], info: [],
  };
  for (const i of issues) groups[i.severity].push(i);

  const lines: string[] = [];
  for (const sev of ["critical", "high", "medium", "low", "info"] as Severity[]) {
    const g = groups[sev];
    if (g.length === 0) continue;
    const header = `${ICON[sev]} ${sev.toUpperCase()} (${g.length})`;
    lines.push(useColor() ? `${COLOR[sev]}${BOLD}${header}${RESET}` : header);
    for (const i of g) {
      const where = formatWhere(i);
      const tail = useColor() ? `${DIM}(${i.rule})${RESET}` : `(${i.rule})`;
      lines.push(`  ${where}  ${i.message} ${tail}`);
      if (i.fix_hint) {
        lines.push(useColor() ? `    ${DIM}→ ${i.fix_hint}${RESET}` : `    → ${i.fix_hint}`);
      }
    }
    lines.push("");
  }
  lines.push(`${stats.total} issue(s) across ${stats.endpoints} endpoint(s)`);
  return lines.join("\n") + "\n";
}

function formatWhere(i: Issue): string {
  if (i.path && i.method && i.method !== "*") return `${i.method} ${i.path}`;
  if (i.path) return i.path;
  return i.jsonpointer;
}

export function formatNdjson(issues: Issue[]): string {
  return issues.map(i => JSON.stringify(i)).join("\n") + (issues.length ? "\n" : "");
}

/**
 * TASK-279: rule × severity rollup. The flat `formatHuman` output has a habit
 * of producing 700+ lines on real-world specs (one large SaaS spec we
 * benchmarked had 385 of 714 issues from a single rule). This collapses
 * them to one row per rule so a human can
 * triage by impact instead of `grep '(B1)' | wc -l`.
 */
export interface RuleSummaryEntry {
  rule: string;
  severity: Severity;
  count: number;
  endpoints: number;
  message: string;
  sample?: { method?: string; path?: string; jsonpointer?: string };
}

export function buildRuleSummary(issues: Issue[]): RuleSummaryEntry[] {
  type Bucket = { rule: string; severity: Severity; count: number; endpointSet: Set<string>; message: string; sample?: RuleSummaryEntry["sample"] };
  const map = new Map<string, Bucket>();
  for (const i of issues) {
    const key = `${i.rule}|${i.severity}`;
    let b = map.get(key);
    if (!b) {
      b = { rule: i.rule, severity: i.severity, count: 0, endpointSet: new Set(), message: i.message };
      if (i.path || i.method || i.jsonpointer) {
        b.sample = { method: i.method, path: i.path, jsonpointer: i.jsonpointer };
      }
      map.set(key, b);
    }
    b.count++;
    if (i.path) b.endpointSet.add(`${i.method ?? "*"} ${i.path}`);
    else if (i.jsonpointer) b.endpointSet.add(i.jsonpointer);
  }
  return [...map.values()]
    .sort((a, b) => rankSeverity(a.severity) - rankSeverity(b.severity) || b.count - a.count)
    .map(b => ({
      rule: b.rule,
      severity: b.severity,
      count: b.count,
      endpoints: b.endpointSet.size,
      message: b.message,
      ...(b.sample ? { sample: b.sample } : {}),
    }));
}

export function formatGrouped(issues: Issue[], stats: LintStats, opts: { top?: number } = {}): string {
  if (issues.length === 0) {
    return useColor() ? `${BOLD}✓ no issues${RESET}\n` : "✓ no issues\n";
  }
  const summary = buildRuleSummary(issues);
  const rows = opts.top != null && opts.top > 0 ? summary.slice(0, opts.top) : summary;

  const lines: string[] = [];
  let lastSev: Severity | null = null;
  for (const r of rows) {
    if (r.severity !== lastSev) {
      const header = `${ICON[r.severity]} ${r.severity.toUpperCase()}`;
      lines.push(useColor() ? `${COLOR[r.severity]}${BOLD}${header}${RESET}` : header);
      lastSev = r.severity;
    }
    const tag = useColor() ? `${COLOR[r.severity]}${r.rule}${RESET}` : r.rule;
    const endpointsLabel = r.endpoints === r.count ? `${r.count}` : `${r.count} (${r.endpoints} endpoints)`;
    lines.push(`  ${tag.padEnd(useColor() ? 14 : 4)}  ${endpointsLabel.padStart(6)}  ${r.message}`);
  }
  lines.push("");
  const truncated = opts.top != null && opts.top > 0 && summary.length > rows.length
    ? ` (showing top ${rows.length} of ${summary.length} rules; pass --top 0 or --verbose for all)`
    : "";
  lines.push(`${stats.total} issue(s) across ${stats.endpoints} endpoint(s)${truncated}. Re-run with --verbose for the flat list.`);
  return lines.join("\n") + "\n";
}
