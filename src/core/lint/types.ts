import type { RecommendedAction } from "../diagnostics/failure-hints.ts";

// Severity unified in src/core/severity (ARV-250). Lint historically used a
// 3-tier ladder (high/medium/low) without 'critical' or 'info'. ARV-255
// will downgrade most lint findings to info/low; this re-export aligns the
// type but does not yet change DEFAULT_SEVERITY values per rule.
import type { Severity } from "../severity/index.ts";
export type { Severity };

export type { RecommendedAction };

export type RuleId =
  | "A1" | "A2" | "A3" | "A4" | "A5" | "A6"
  | "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7" | "B8" | "B9";

export const ALL_RULES: RuleId[] = [
  "A1", "A2", "A3", "A4", "A5", "A6",
  "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9",
];

/**
 * ARV-255 (m-21 pivot): all lint findings cap at LOW/INFO. Static spec
 * analysis is hygiene — no runtime evidence, no exploit pathway, no
 * security or contract drift. The old "HIGH on missing additionalProperties"
 * inflation made the audit report unreadable; now lint lives in the
 * hygiene category and surfaces via `zond lint` separately.
 *
 * Tier assignment:
 * - `low`: real spec violations (format mismatch in example, missing
 *   path-param format, response without schema). Worth fixing, but not
 *   security.
 * - `info`: style and documentation gaps (additionalProperties, naming,
 *   missing examples, optional descriptions). Could be intentional.
 */
export const DEFAULT_SEVERITY: Record<RuleId, Severity> = {
  A1: "low",    A2: "low",    A3: "info",   A4: "info",   A5: "info",   A6: "info",
  B1: "low",    B2: "info",   B3: "info",   B4: "info",   B5: "info",
  B6: "info",   B7: "low",    B8: "info",   B9: "info",
};

export interface Issue {
  rule: RuleId;
  severity: Severity;
  path?: string;
  method?: string;
  jsonpointer: string;
  message: string;
  fix_hint?: string;
  affects?: string[];
  /** TASK-294: agent-routable action — always `fix_spec` for lint issues
   *  (the spec is the source of truth and the only thing to edit). */
  recommended_action: RecommendedAction;
}

export type RuleSetting = "off" | Severity;

export interface HeuristicConfig {
  id_suffixes: string[];
  timestamp_suffixes: string[];
  url_names: string[];
  cursor_names: string[];
  pagination_names: string[];
  semantic_required: string[];
}

export interface LintConfig {
  rules: Partial<Record<RuleId, RuleSetting>>;
  heuristics: HeuristicConfig;
  ignore_paths: string[];
  include_paths?: string[];
  max_issues?: number;
}

export interface LintStats {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  endpoints: number;
}

export interface LintResult {
  issues: Issue[];
  stats: LintStats;
}

export const DEFAULT_HEURISTICS: HeuristicConfig = {
  id_suffixes: ["_id", "Id", "ID"],
  timestamp_suffixes: ["_at", "_date", "_time"],
  url_names: ["url", "website", "homepage", "callback_url", "webhook_url"],
  cursor_names: ["after", "before", "cursor", "token", "page_token", "next_token"],
  pagination_names: ["limit", "offset", "page", "size", "count", "per_page", "page_size"],
  semantic_required: ["name", "email", "title"],
};
