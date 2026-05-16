/**
 * ARV-10 (m-15): NDJSON streaming reporter for `zond checks run`.
 *
 * Each event is a single JSON line on stdout — agents pipe the stream
 * into `jq` / ajv / their own consumer and act on findings *as they
 * happen* instead of waiting for the run to wrap up. The discriminated
 * union of event shapes lives in `src/cli/json-schemas.ts` (zod source
 * of truth) and ships as `docs/json-schema/ndjson-events.schema.json`.
 *
 * The CLI passes `emitToStdout` as the `onEvent` callback to runChecks;
 * tests can pass an in-memory accumulator instead.
 */
import type { z } from "zod";
import type {
  NdjsonCheckStartEventSchema,
  NdjsonCheckResultEventSchema,
  NdjsonFindingEventSchema,
  NdjsonSummaryEventSchema,
  NdjsonEventSchema,
} from "../../cli/json-schemas.ts";

export type NdjsonCheckStartEvent = z.infer<typeof NdjsonCheckStartEventSchema>;
export type NdjsonCheckResultEvent = z.infer<typeof NdjsonCheckResultEventSchema>;
export type NdjsonFindingEvent = z.infer<typeof NdjsonFindingEventSchema>;
export type NdjsonSummaryEvent = z.infer<typeof NdjsonSummaryEventSchema>;
export type NdjsonEvent = z.infer<typeof NdjsonEventSchema>;

/** Write one event to stdout as a single line. AC #5 — when the CLI is
 *  in `--ndjson` mode, *every* user-readable message goes to stderr, so
 *  stdout stays a clean NDJSON stream that pipes into `jq` / ajv. */
export function emitToStdout(ev: NdjsonEvent): void {
  process.stdout.write(`${JSON.stringify(ev)}\n`);
}

export function nowIso(): string {
  return new Date().toISOString();
}
