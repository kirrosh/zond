export interface JsonEnvelope<T = unknown> {
  ok: boolean;
  command: string;
  data: T;
  warnings: string[];
  errors: string[];
}

export function jsonOk<T>(command: string, data: T, warnings?: string[]): JsonEnvelope<T> {
  return { ok: true, command, data, warnings: warnings ?? [], errors: [] };
}

export function jsonError(command: string, errors: string[], warnings?: string[]): JsonEnvelope<null> {
  return { ok: false, command, data: null, warnings: warnings ?? [], errors };
}

export function printJson(envelope: JsonEnvelope): void {
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
}
