/**
 * Single source of truth for `--json` output across all CLI commands.
 *
 * Every `--json` response carries the same envelope:
 *
 *   { ok, command, data, warnings, errors, exit_code? }
 *
 * Commands construct the payload (`data`) and ask one of the helpers
 * below to render it. Don't `console.log(JSON.stringify(...))` ad-hoc
 * for `--json` paths — go through `printJson` / `writeEnvelope` so the
 * shape stays uniform (TASK-73, TASK-74, closed by TASK-184).
 *
 * TASK-296: errors[] is a list of `{code, message, details?}` so an
 * agent can route on `code` without parsing the human message. Helpers
 * accept either a bare `string` (auto-wrapped with code `unknown_error`)
 * or a structured `ZondError` to keep call sites short.
 */

// TASK-295: types are derived from the zod schemas in `./json-schemas.ts`
// so the published JSON Schema (docs/json-schema/) and the runtime types
// can never drift. Edit the enum/object there, run `bun run schemas`,
// commit the regenerated docs.
import type { z } from "zod";
import {
  ZondErrorCodeSchema,
  ZondErrorSchema,
} from "./json-schemas.ts";

export type ZondErrorCode = z.infer<typeof ZondErrorCodeSchema>;
export type ZondError = z.infer<typeof ZondErrorSchema>;

export interface JsonEnvelope<T = unknown> {
  ok: boolean;
  command: string;
  data: T;
  warnings: string[];
  errors: ZondError[];
  /** Exit code the process will return. Present on error envelopes so a
   *  caller can read the taxonomy class without re-parsing $? from a shell
   *  (see ZOND.md → "Exit codes"). */
  exit_code?: number;
}

/** Accept either a bare string (auto-coded `unknown_error`) or a fully-
 *  structured `ZondError`. Lets us migrate ~100 call sites incrementally
 *  without breaking the schema. */
export type ErrorInput = string | ZondError;

function normalizeErrors(errs: readonly ErrorInput[]): ZondError[] {
  return errs.map(e =>
    typeof e === "string" ? { code: "unknown_error" as const, message: e } : e,
  );
}

export function jsonOk<T>(command: string, data: T, warnings?: string[]): JsonEnvelope<T> {
  return { ok: true, command, data, warnings: warnings ?? [], errors: [] };
}

export function jsonError(
  command: string,
  errors: readonly ErrorInput[],
  warnings?: string[],
  exitCode = 2,
): JsonEnvelope<null> {
  return {
    ok: false,
    command,
    data: null,
    warnings: warnings ?? [],
    errors: normalizeErrors(errors),
    exit_code: exitCode,
  };
}

export function printJson(envelope: JsonEnvelope): void {
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
}

/** Convenience constructor: `zerr("env_missing", "base_url not set", { var: "base_url" })`. */
export function zerr(code: ZondErrorCode, message: string, details?: Record<string, unknown>): ZondError {
  return details ? { code, message, details } : { code, message };
}

/** Discriminated-union result an action can hand back to {@link writeEnvelope}. */
export type EnvelopeResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; errors: readonly ErrorInput[]; warnings?: string[]; exitCode?: number };

/**
 * Render a typed `EnvelopeResult` to stdout as a JSON envelope and return
 * the process exit code (0 on ok, `result.exitCode ?? 2` on error). This
 * is the recommended wrapper for new commands — it lets the handler
 * focus on producing a payload and surfaces the right exit code in one
 * call:
 *
 *     const result = await doWork();
 *     if (options.json) return writeEnvelope("my-cmd", result);
 *     // …human path…
 */
export function writeEnvelope<T>(command: string, result: EnvelopeResult<T>): number {
  if (result.ok) {
    printJson(jsonOk(command, result.data, result.warnings));
    return 0;
  }
  const exit = result.exitCode ?? 2;
  printJson(jsonError(command, result.errors, result.warnings, exit));
  return exit;
}
