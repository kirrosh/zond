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
