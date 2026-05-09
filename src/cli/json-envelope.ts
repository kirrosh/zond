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

/**
 * Closed enum of agent-routable error categories. New values land here
 * before they're emitted at any call site so the schema stays self-
 * describing. `unknown_error` is the default when a site hasn't been
 * classified yet — it is intentionally surfaced (not silent) so that
 * search-and-classify passes are easy.
 */
export type ZondErrorCode =
  | "unknown_error"
  /** Required env var / .env.yaml entry missing or placeholder. */
  | "env_missing"
  /** Fixture id (path-param, FK) absent or unresolvable from .env.yaml. */
  | "fixture_missing"
  /** Live HTTP request timed out. */
  | "network_timeout"
  /** Generic network failure (DNS, connection refused, TLS, …). */
  | "network_error"
  /** Outbound request blocked by a sandbox / firewall (CI restrictions). */
  | "sandbox_blocked"
  /** OpenAPI spec or YAML config failed to load / parse / validate. */
  | "spec_load_failure"
  /** YAML test suite failed to parse. */
  | "yaml_parse_error"
  /** Workspace anchor (zond.config.yml / .zond/) not found. */
  | "workspace_not_found"
  /** Required file or directory missing. */
  | "file_not_found"
  /** Filesystem permission / read-only failure. */
  | "permission_denied"
  /** CLI argument / option invalid or missing. */
  | "argument_invalid"
  /** Requested API name not registered (per `zond list-apis`). */
  | "api_not_registered"
  /** SQLite / db layer failure. */
  | "db_error"
  /** Auth/credentials misconfigured (token missing, bearer format wrong, …). */
  | "auth_config_error";

export interface ZondError {
  code: ZondErrorCode;
  message: string;
  /** Optional structured payload (path, status, var name, …) — kept loose
   *  on purpose so each call site can attach what it has without growing
   *  the central enum. */
  details?: Record<string, unknown>;
}

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

/**
 * High-order wrapper for `--json` action handlers. Accepts an async
 * producer and renders its return value (or thrown error) as an
 * envelope. Errors thrown synchronously or asynchronously become
 * `{ ok: false, errors: [{code: "unknown_error", message}] }` with
 * `exitCode = 2`.
 */
export async function withEnvelope<T>(
  command: string,
  produce: () => Promise<{ data: T; warnings?: string[] }>,
): Promise<number> {
  try {
    const { data, warnings } = await produce();
    return writeEnvelope(command, { ok: true, data, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return writeEnvelope(command, { ok: false, errors: [message] });
  }
}
