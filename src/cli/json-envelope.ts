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
 */

export interface JsonEnvelope<T = unknown> {
  ok: boolean;
  command: string;
  data: T;
  warnings: string[];
  errors: string[];
  /** Exit code the process will return. Present on error envelopes so a
   *  caller can read the taxonomy class without re-parsing $? from a shell
   *  (see ZOND.md → "Exit codes"). */
  exit_code?: number;
}

export function jsonOk<T>(command: string, data: T, warnings?: string[]): JsonEnvelope<T> {
  return { ok: true, command, data, warnings: warnings ?? [], errors: [] };
}

export function jsonError(
  command: string,
  errors: string[],
  warnings?: string[],
  exitCode = 2,
): JsonEnvelope<null> {
  return { ok: false, command, data: null, warnings: warnings ?? [], errors, exit_code: exitCode };
}

export function printJson(envelope: JsonEnvelope): void {
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
}

/** Discriminated-union result an action can hand back to {@link writeEnvelope}. */
export type EnvelopeResult<T> =
  | { ok: true; data: T; warnings?: string[] }
  | { ok: false; errors: string[]; warnings?: string[]; exitCode?: number };

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
 * `{ ok: false, errors: [message] }` with `exitCode = 2`.
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
