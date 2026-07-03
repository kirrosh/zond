/**
 * ARV-283 Phase A: per-API severity calibration config.
 *
 * Types + loader for `.zond/severity.yaml` (workspace) and
 * `apis/<name>/.zond-severity.yaml` (per-API). Workspace and per-API
 * configs are merged with documented precedence — per-API wins on
 * `checks[<id>].severity` overrides; suppressions union (additive).
 *
 * Schema validation is intentionally hand-rolled (no zod dep): the
 * config is small and the error messages we want — file path + key
 * path + expected enum — are easier to produce manually than to
 * decode from a generic schema-validator. JSON-schema export for
 * editor autocomplete can come in Phase C with `severity explain`.
 *
 * What this module does NOT do:
 *   - Read files (loader.ts owns disk I/O — keeps this pure for tests)
 *   - Evaluate `when:` clauses (matcher.ts owns evaluation)
 *   - Apply the calibration (calibrator.ts orchestrates)
 *
 * Design constraints (per ARV-283 epic Non-goals):
 *   - Does NOT replace `recommended_action` enum (enum stays
 *     source-of-truth; config maps enum → severity)
 *   - Does NOT replace `tolerated-drifts.yaml` (those live on
 *     test-suite level; this works on check/probe finding level)
 */

import type { Severity } from "./index.ts";
import type { RecommendedAction } from "../diagnostics/failure-hints.ts";

/** Re-export for callers that build CalibrationInput / read results. */
export type CalibratedSeverity = Severity;

/** Per-check override block in severity.yaml. */
export interface CheckOverride {
  /** Override severity for every finding from this check. Mutually
   *  exclusive with `by_action` — if both set, `by_action` wins when it
   *  matches, otherwise `severity` applies. */
  severity?: Severity;
  /** Per-recommended-action severity map. Lets `negative_data_rejection`
   *  with `recommended_action: tighten_validation` become MEDIUM while
   *  same check with `report_backend_bug` stays HIGH. */
  by_action?: Partial<Record<RecommendedAction, Severity>>;
}

/** Suppression rule — filter a finding based on its context. Match all
 *  `when:` conditions to suppress. Suppressed findings emit with
 *  `severity: "info-suppressed"` and `suppressed_by` trace; they remain
 *  in ndjson but are excluded from CI gates (--fail-on-coverage etc). */
export interface SuppressionRule {
  /** Check id this rule applies to. Wildcards not supported in Phase A
   *  (per-check rules force the author to surface intent). */
  check: string;
  /** All conditions must match — AND semantics. Empty `when:` is an
   *  error (would silently suppress every finding from the check). */
  when: ConditionMap;
  /** Human-readable reason — surfaces in `suppressed_by.reason`. */
  reason: string;
}

/** Condition map — keys are dot-paths into the finding context, values
 *  are either a literal (shorthand for `equals`) or an operator block.
 *  Path grammar lives in matcher.ts — config layer is just shape. */
export type ConditionMap = Record<string, ConditionValue>;

export type ConditionValue =
  | string
  | number
  | boolean
  | { present: true }
  | { absent: true }
  | { equals: string | number | boolean }
  | { contains: string }
  | { matches: string }
  | { in: Array<string | number> };

/** Root config shape. */
export interface SeverityConfig {
  version: 1;
  checks?: Record<string, CheckOverride>;
  suppressions?: SuppressionRule[];
}

/** Loaded + validated config with provenance (which file each rule
 *  came from). Calibrator uses `source` to populate `suppressed_by`. */
export interface LoadedConfig {
  config: SeverityConfig;
  /** Absolute path the config was read from. */
  source: string;
}

/** Stack of configs in precedence order (later wins for `checks[]`,
 *  union for `suppressions[]`). */
export type ConfigStack = LoadedConfig[];

// ─── Validation ──────────────────────────────────────────────────────

const VALID_SEVERITIES: ReadonlySet<Severity> = new Set([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

const VALID_OPERATORS: ReadonlySet<string> = new Set([
  "present",
  "absent",
  "equals",
  "contains",
  "matches",
  "in",
]);

export interface ValidationError {
  source: string;
  keyPath: string;
  message: string;
}

/**
 * Validate a parsed config (yaml → object). Returns an array of
 * errors; empty array = valid. Each error carries file + dot-path so
 * the CLI can print `severity.yaml:checks.foo: ...` (AC#2).
 *
 * Hand-rolled because zod would lose the dot-path precision we want
 * for error messages — and the schema is small enough that the
 * payoff isn't there.
 */
export function validateConfig(raw: unknown, source: string): ValidationError[] {
  const errors: ValidationError[] = [];
  if (raw === null || raw === undefined) {
    return errors; // empty file = no rules, treat as valid
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ source, keyPath: "$", message: "expected object at root" });
    return errors;
  }
  const root = raw as Record<string, unknown>;

  if (!("version" in root)) {
    errors.push({ source, keyPath: "version", message: "required field missing" });
  } else if (root.version !== 1) {
    errors.push({
      source,
      keyPath: "version",
      message: `unsupported version ${JSON.stringify(root.version)}, expected 1`,
    });
  }

  if ("checks" in root) {
    if (typeof root.checks !== "object" || Array.isArray(root.checks) || root.checks === null) {
      errors.push({ source, keyPath: "checks", message: "expected object mapping check ids → overrides" });
    } else {
      for (const [checkId, override] of Object.entries(root.checks)) {
        validateCheckOverride(override, `checks.${checkId}`, source, errors);
      }
    }
  }

  if ("suppressions" in root) {
    if (!Array.isArray(root.suppressions)) {
      errors.push({ source, keyPath: "suppressions", message: "expected array of suppression rules" });
    } else {
      root.suppressions.forEach((rule, idx) => {
        validateSuppression(rule, `suppressions[${idx}]`, source, errors);
      });
    }
  }

  return errors;
}

function validateCheckOverride(
  raw: unknown,
  keyPath: string,
  source: string,
  errors: ValidationError[],
): void {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ source, keyPath, message: "expected object with optional `severity` and `by_action`" });
    return;
  }
  const obj = raw as Record<string, unknown>;
  if ("severity" in obj) {
    if (typeof obj.severity !== "string" || !VALID_SEVERITIES.has(obj.severity as Severity)) {
      errors.push({
        source,
        keyPath: `${keyPath}.severity`,
        message: `unknown severity ${JSON.stringify(obj.severity)}, expected one of ${[...VALID_SEVERITIES].join("|")}`,
      });
    }
  }
  if ("by_action" in obj) {
    if (typeof obj.by_action !== "object" || obj.by_action === null || Array.isArray(obj.by_action)) {
      errors.push({ source, keyPath: `${keyPath}.by_action`, message: "expected object mapping recommended_action → severity" });
    } else {
      for (const [action, sev] of Object.entries(obj.by_action as Record<string, unknown>)) {
        if (typeof sev !== "string" || !VALID_SEVERITIES.has(sev as Severity)) {
          errors.push({
            source,
            keyPath: `${keyPath}.by_action.${action}`,
            message: `unknown severity ${JSON.stringify(sev)}, expected one of ${[...VALID_SEVERITIES].join("|")}`,
          });
        }
      }
    }
  }
}

function validateSuppression(
  raw: unknown,
  keyPath: string,
  source: string,
  errors: ValidationError[],
): void {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ source, keyPath, message: "expected object with `check`, `when`, `reason`" });
    return;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.check !== "string" || obj.check.length === 0) {
    errors.push({ source, keyPath: `${keyPath}.check`, message: "required string field" });
  }
  if (typeof obj.reason !== "string" || obj.reason.length === 0) {
    errors.push({ source, keyPath: `${keyPath}.reason`, message: "required string field — explain why this suppression exists" });
  }
  if (!("when" in obj)) {
    errors.push({ source, keyPath: `${keyPath}.when`, message: "required — empty when: would suppress all findings from this check (use severity override instead)" });
    return;
  }
  if (typeof obj.when !== "object" || obj.when === null || Array.isArray(obj.when)) {
    errors.push({ source, keyPath: `${keyPath}.when`, message: "expected object mapping context-path → condition" });
    return;
  }
  const whenEntries = Object.entries(obj.when as Record<string, unknown>);
  if (whenEntries.length === 0) {
    errors.push({ source, keyPath: `${keyPath}.when`, message: "must have at least one condition" });
  }
  for (const [path, cond] of whenEntries) {
    validateCondition(cond, `${keyPath}.when.${path}`, source, errors);
  }
}

function validateCondition(
  raw: unknown,
  keyPath: string,
  source: string,
  errors: ValidationError[],
): void {
  // Shorthand: literal scalar = equals
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return;
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({
      source,
      keyPath,
      message: `expected scalar (equals-shorthand) or operator object {${[...VALID_OPERATORS].join("|")}}`,
    });
    return;
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    errors.push({ source, keyPath, message: `expected exactly one operator key, got ${keys.length} (${keys.join(", ")})` });
    return;
  }
  const op = keys[0]!;
  if (!VALID_OPERATORS.has(op)) {
    errors.push({
      source,
      keyPath: `${keyPath}.${op}`,
      message: `unknown operator ${JSON.stringify(op)}, expected one of ${[...VALID_OPERATORS].join("|")}`,
    });
    return;
  }
  const value = obj[op];
  if (op === "present" || op === "absent") {
    if (value !== true) {
      errors.push({ source, keyPath: `${keyPath}.${op}`, message: `${op} expects literal \`true\`` });
    }
  } else if (op === "in") {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push({ source, keyPath: `${keyPath}.in`, message: "expected non-empty array" });
    }
  } else if (op === "matches" || op === "contains") {
    if (typeof value !== "string") {
      errors.push({ source, keyPath: `${keyPath}.${op}`, message: `${op} expects string` });
    } else if (op === "matches") {
      try {
        new RegExp(value);
      } catch (err) {
        errors.push({ source, keyPath: `${keyPath}.matches`, message: `invalid regex: ${(err as Error).message}` });
      }
    }
  }
  // equals: any scalar accepted — validated implicitly by JS runtime
}

/**
 * Merge a stack of configs into a single resolved view. Precedence:
 *   - `checks[<id>].severity` and `by_action`: later configs win
 *     (per-key, not whole-object — `by_action` entries merge).
 *   - `suppressions[]`: union, preserving source for `suppressed_by`.
 */
export interface MergedConfig {
  checks: Record<string, CheckOverride>;
  /** Suppressions with their source file attached for trace. */
  suppressions: Array<SuppressionRule & { sourceFile: string; index: number }>;
}

export function mergeConfigs(stack: ConfigStack): MergedConfig {
  const checks: Record<string, CheckOverride> = {};
  const suppressions: MergedConfig["suppressions"] = [];
  for (const { config, source } of stack) {
    if (config.checks) {
      for (const [checkId, override] of Object.entries(config.checks)) {
        const existing = checks[checkId] ?? {};
        checks[checkId] = {
          severity: override.severity ?? existing.severity,
          by_action: { ...existing.by_action, ...override.by_action },
        };
      }
    }
    if (config.suppressions) {
      config.suppressions.forEach((rule, idx) => {
        suppressions.push({ ...rule, sourceFile: source, index: idx });
      });
    }
  }
  return { checks, suppressions };
}
