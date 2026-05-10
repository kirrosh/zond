/**
 * TASK-295: zod sources of truth for the `--json` envelope shape and its
 * sub-types. Run `bun run scripts/emit-json-schemas.ts` after changing
 * any of these to regenerate `docs/json-schema/*.schema.json`.
 *
 * Why zod first, JSON Schema second: zod is the type AND the validator
 * we already ship; emitting JSON Schema from it keeps the published
 * schema and the runtime checks in lock-step. New fields land here and
 * propagate, instead of drifting between two hand-maintained shapes.
 */

import { z } from "zod";

/** TASK-296 closed enum — must stay in sync with `ZondErrorCode` in
 *  `src/cli/json-envelope.ts`. */
export const ZondErrorCodeSchema = z.enum([
  "unknown_error",
  "env_missing",
  "fixture_missing",
  "network_timeout",
  "network_error",
  "sandbox_blocked",
  "spec_load_failure",
  "yaml_parse_error",
  "workspace_not_found",
  "file_not_found",
  "permission_denied",
  "argument_invalid",
  "api_not_registered",
  "db_error",
  "auth_config_error",
]);

export const ZondErrorSchema = z.object({
  code: ZondErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** TASK-294 closed enum — must stay in sync with `RecommendedAction` in
 *  `src/core/diagnostics/failure-hints.ts` and the per-check mapping in
 *  `src/core/checks/recommended-action.ts` (ARV-11).
 *  ARV-11 added three values for the depth-checks framework:
 *    - `tighten_validation` — server accepted invalid input.
 *    - `add_required_header` — server didn't enforce a required header.
 *    - `wontfix_known_limitation` — known/accepted gap; agent should
 *       not retry or report. */
export const RecommendedActionSchema = z.enum([
  "report_backend_bug",
  "fix_auth_config",
  "fix_test_logic",
  "fix_network_config",
  "fix_env",
  "fix_spec",
  "fix_fixture",
  // ARV-42 — re-run `zond generate` for failures rooted in generator-emitted
  // bodies; editing the YAML directly is overwritten by the next regenerate.
  "regenerate_suite",
  "tighten_validation",
  "add_required_header",
  "wontfix_known_limitation",
]);

/** Envelope body. `data` is open (`unknown`) so this schema covers every
 *  command without enumerating each payload — command-specific schemas
 *  can refine `data` per-command in a follow-up. */
export const JsonEnvelopeSchema = z.object({
  ok: z.boolean(),
  command: z.string(),
  data: z.unknown(),
  warnings: z.array(z.string()),
  errors: z.array(ZondErrorSchema),
  exit_code: z.number().int().optional(),
});

/** ARV-1 (m-15): shape of `data` for `zond checks run --json`. The
 *  envelope itself stays the generic JsonEnvelopeSchema; this schema
 *  pins the per-command payload so agents can validate findings without
 *  parsing them by-hand. ARV-11 adds `recommended_action` as a closed
 *  enum on each finding. */
export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);

export const CheckFindingSchema = z.object({
  check: z.string(),
  severity: SeveritySchema,
  operation: z.object({
    path: z.string(),
    method: z.string(),
    operationId: z.string().optional(),
  }),
  request_signature: z.string(),
  response_summary: z.object({
    status: z.number().int(),
    content_type: z.string().optional(),
  }),
  message: z.string(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  // ARV-11: recommended_action is now a closed enum so agents can
  // route on it without parsing free-form strings. Same enum used by
  // `db diagnose` (TASK-294) plus three depth-check additions.
  recommended_action: RecommendedActionSchema.optional(),
});

export const CheckRunSummarySchema = z.object({
  operations: z.number().int().nonnegative(),
  cases: z.number().int().nonnegative(),
  checks_run: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  by_severity: z.object({
    low: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    critical: z.number().int().nonnegative(),
  }),
  // ARV-26: per-(check, reason) skip tally — surfaces probe outcomes that
  // never produced a checkable response (e.g. probe got 4xx, schema only on
  // 200) so "0 findings" doesn't read as "all green".
  skipped_outcomes: z.record(z.string(), z.number().int().nonnegative()),
});

export const ChecksRunDataSchema = z.object({
  findings: z.array(CheckFindingSchema),
  summary: CheckRunSummarySchema,
});

/** ARV-10 (m-15): NDJSON streaming events emitted by `zond checks run
 *  --ndjson`. Each event is a snapshot JSON line on stdout — agents pipe
 *  the stream into `jq` / a validator and consume findings as they happen
 *  rather than waiting for the run to finish. The discriminated union
 *  below is the schema we publish — every emitted line MUST match one
 *  branch exactly (verified by ajv in tests). */
const OperationRefSchema = z.object({
  path: z.string(),
  method: z.string(),
  operationId: z.string().optional(),
});

export const NdjsonCheckStartEventSchema = z.object({
  type: z.literal("check_start"),
  ts: z.string(),
  operation: OperationRefSchema,
});

export const NdjsonCheckResultEventSchema = z.object({
  type: z.literal("check_result"),
  ts: z.string(),
  check: z.string(),
  verdict: z.enum(["pass", "fail"]),
  operation: OperationRefSchema,
  request_signature: z.string(),
  response: z.object({
    status: z.number().int(),
    content_type: z.string().optional(),
  }),
});

export const NdjsonFindingEventSchema = z.object({
  type: z.literal("finding"),
  ts: z.string(),
  finding: CheckFindingSchema,
});

export const NdjsonSummaryEventSchema = z.object({
  type: z.literal("summary"),
  ts: z.string(),
  summary: CheckRunSummarySchema,
});

export const NdjsonEventSchema = z.discriminatedUnion("type", [
  NdjsonCheckStartEventSchema,
  NdjsonCheckResultEventSchema,
  NdjsonFindingEventSchema,
  NdjsonSummaryEventSchema,
]);

/** m-17 / ARV-50: shape of `data` for `zond probe <class> --dry-run --json`.
 *  Severity is intentionally absent — nothing is classified yet, so
 *  reusing the run-time bucket would mislead CI gates (F1-15). The
 *  `skip_reason` enum is open across probe families (e.g. security has
 *  `isolated-protected`, mass-assignment has its own subset); we keep
 *  it as a string with documented values rather than a closed enum
 *  that needs to be rev'd every time a new class lands. */
export const ProbeEndpointPlanSchema = z.object({
  path: z.string(),
  method: z.string(),
  planned: z.boolean(),
  classes_planned: z.array(z.string()),
  fields_planned: z.array(z.string()),
  skip_reason: z.string().nullable(),
});

export const ProbeDryRunDataSchema = z.object({
  endpoints: z.array(ProbeEndpointPlanSchema),
  summary: z.object({
    totalEndpoints: z.number().int().nonnegative(),
    planned: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});

/** m-17 / ARV-51: shape of `data` for live probe runs (`zond probe <class>
 *  --report json` or the default `--json`). One entry per endpoint with
 *  structured findings — no markdown blob. The legacy `data.digest.stdout`
 *  field is gone (F3-15 / F4-15). */
export const ProbeFindingSchema = z.object({
  class: z.string(),
  severity: z.enum(["high", "low", "inconclusive", "ok"]),
  evidence: z.record(z.string(), z.unknown()),
});

export const ProbeEndpointResultSchema = z.object({
  path: z.string(),
  method: z.string(),
  classes_run: z.array(z.string()),
  findings: z.array(ProbeFindingSchema),
  status: z.enum(["ok", "high", "low", "inconclusive", "skipped"]),
  skip_reason: z.string().optional(),
});

export const ProbeRunDataSchema = z.object({
  endpoints: z.array(ProbeEndpointResultSchema),
  summary: z.object({
    totalEndpoints: z.number().int().nonnegative(),
    probed: z.number().int().nonnegative(),
    by_status: z.object({
      ok: z.number().int().nonnegative(),
      high: z.number().int().nonnegative(),
      low: z.number().int().nonnegative(),
      inconclusive: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    }),
  }),
});

export const SCHEMAS = {
  envelope: JsonEnvelopeSchema,
  error: ZondErrorSchema,
  errorCode: ZondErrorCodeSchema,
  recommendedAction: RecommendedActionSchema,
  checksRunData: ChecksRunDataSchema,
  checkFinding: CheckFindingSchema,
  "ndjson-events": NdjsonEventSchema,
  probeDryRun: ProbeDryRunDataSchema,
  probeRun: ProbeRunDataSchema,
} as const;
