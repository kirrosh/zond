import { readFileSync, existsSync } from "fs";
import type { LintConfig, RuleId, RuleSetting } from "./types.ts";
import { ALL_RULES, DEFAULT_HEURISTICS, DEFAULT_SEVERITY } from "./types.ts";

export function defaultConfig(): LintConfig {
  const rules: Partial<Record<RuleId, RuleSetting>> = {};
  for (const r of ALL_RULES) rules[r] = DEFAULT_SEVERITY[r];
  return {
    rules,
    heuristics: { ...DEFAULT_HEURISTICS },
    ignore_paths: [],
  };
}

interface RawConfig {
  rules?: Record<string, string>;
  heuristics?: Partial<typeof DEFAULT_HEURISTICS>;
  ignore_paths?: string[];
}

/**
 * Merge order: defaults → file config (.zond-lint.json) → CLI --rule overrides.
 * --rule format: comma-separated `R1` (enable at default severity), `!R1`
 * (disable), or `R1=high|medium|low` (set severity).
 */
export function loadConfig(opts: {
  configPath?: string;
  cliRule?: string;
  includePaths?: string[];
  maxIssues?: number;
}): LintConfig {
  const cfg = defaultConfig();

  if (opts.configPath) {
    if (!existsSync(opts.configPath)) {
      throw new Error(`Config file not found: ${opts.configPath}`);
    }
    const raw = JSON.parse(readFileSync(opts.configPath, "utf8")) as RawConfig;
    if (raw.rules) {
      for (const [rule, val] of Object.entries(raw.rules)) {
        if (!ALL_RULES.includes(rule as RuleId)) continue;
        cfg.rules[rule as RuleId] = normaliseSetting(val);
      }
    }
    if (raw.heuristics) cfg.heuristics = { ...cfg.heuristics, ...raw.heuristics };
    if (raw.ignore_paths) cfg.ignore_paths = raw.ignore_paths;
  }

  if (opts.cliRule) {
    for (const tok of opts.cliRule.split(",").map(s => s.trim()).filter(Boolean)) {
      if (tok.startsWith("!")) {
        const r = tok.slice(1) as RuleId;
        if (ALL_RULES.includes(r)) cfg.rules[r] = "off";
      } else if (tok.includes("=")) {
        const [r, sev] = tok.split("=") as [RuleId, string];
        if (ALL_RULES.includes(r)) cfg.rules[r] = normaliseSetting(sev);
      } else {
        const r = tok as RuleId;
        if (ALL_RULES.includes(r)) cfg.rules[r] = DEFAULT_SEVERITY[r];
      }
    }
  }

  if (opts.includePaths && opts.includePaths.length > 0) cfg.include_paths = opts.includePaths;
  if (opts.maxIssues) cfg.max_issues = opts.maxIssues;
  return cfg;
}

function normaliseSetting(raw: string): RuleSetting {
  const v = raw.toLowerCase();
  if (v === "off" || v === "false" || v === "no") return "off";
  if (v === "high" || v === "error") return "high";
  if (v === "medium" || v === "warn" || v === "warning") return "medium";
  if (v === "low" || v === "info" || v === "informational") return "low";
  return "off";
}

/**
 * Glob matcher — supports `*` and `**`. Used for `ignore_paths` /
 * `include_paths`.
 */
export function matchGlob(glob: string, path: string): boolean {
  const re = new RegExp(
    "^" + glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<<<DSTAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<DSTAR>>>/g, ".*") +
      "$",
  );
  return re.test(path);
}
