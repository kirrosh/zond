import type { Issue, LintStats, Severity } from "./types.ts";

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const useColor = (): boolean => process.stdout.isTTY === true;

const ICON: Record<Severity, string> = { high: "🚨", medium: "⚠️ ", low: "ℹ️ " };
const COLOR: Record<Severity, string> = { high: RED, medium: YELLOW, low: DIM };

export function formatHuman(issues: Issue[], stats: LintStats): string {
  if (issues.length === 0) {
    return useColor() ? `${BOLD}✓ no issues${RESET}\n` : "✓ no issues\n";
  }
  const groups: Record<Severity, Issue[]> = { high: [], medium: [], low: [] };
  for (const i of issues) groups[i.severity].push(i);

  const lines: string[] = [];
  for (const sev of ["high", "medium", "low"] as Severity[]) {
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
