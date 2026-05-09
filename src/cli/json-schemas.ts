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
 *  `src/core/diagnostics/failure-hints.ts`. */
export const RecommendedActionSchema = z.enum([
  "report_backend_bug",
  "fix_auth_config",
  "fix_test_logic",
  "fix_network_config",
  "fix_env",
  "fix_spec",
  "fix_fixture",
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

export const SCHEMAS = {
  envelope: JsonEnvelopeSchema,
  error: ZondErrorSchema,
  errorCode: ZondErrorCodeSchema,
  recommendedAction: RecommendedActionSchema,
} as const;
