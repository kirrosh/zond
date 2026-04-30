export type Severity = "high" | "medium" | "low";

export type RuleId =
  | "A1" | "A2" | "A3" | "A4" | "A5" | "A6"
  | "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7" | "B8" | "B9";

export const ALL_RULES: RuleId[] = [
  "A1", "A2", "A3", "A4", "A5", "A6",
  "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9",
];

export const DEFAULT_SEVERITY: Record<RuleId, Severity> = {
  A1: "high",   A2: "high",   A3: "medium", A4: "medium", A5: "medium", A6: "low",
  B1: "high",   B2: "low",    B3: "medium", B4: "low",    B5: "medium",
  B6: "low",    B7: "high",   B8: "low",    B9: "low",
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
  high: number;
  medium: number;
  low: number;
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
