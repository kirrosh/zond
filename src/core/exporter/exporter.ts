/**
 * Single sanitization seam for everything zond writes to disk or stdout.
 *
 * Background: m-10 (TASK-166..168) introduced a secrets registry and
 * `redact()` helper. The first wave of work added `redact(...)` calls
 * inside individual exporters and reporters, which means a new exporter
 * is one missing call away from leaking a secret. TASK-186 collapses
 * that risk: every exporter declares a pure `render()` and goes through
 * the {@link runExporter} pipeline, which applies the sanitizer exactly
 * once at the boundary.
 *
 * The interface is deliberately string-out only — every consumer
 * (writeFile, console.log, HTTP body) accepts a string anyway.
 */

import { redact } from "../secrets/registry.ts";

export interface Exporter<I, O = void> {
  /** Stable identifier — used in logs and tests. */
  readonly name: string;
  /** Mime hint for the rendered payload. */
  readonly mime: string;
  /** Pure render — no I/O, no redaction. Receives caller-supplied opts. */
  render(input: I, opts?: O): string;
}

/**
 * Run an exporter's render through the sanitizer pipeline. This is the
 * only place sanitization happens for exporter output — render() must
 * NOT call `redact()` itself, and callers must NOT redact again on top.
 *
 * Sanitization is currently a single pass of {@link redact}; future
 * sanitizer rules (e.g. identity scrubbing) will plug in here so every
 * exporter inherits them automatically.
 */
export function runExporter<I, O>(exporter: Exporter<I, O>, input: I, opts?: O): string {
  return applySanitizer(exporter.render(input, opts));
}

/**
 * Sanitizer pipeline used by {@link runExporter}. Exposed for the
 * handful of sites that build their payload outside the exporter
 * interface (e.g. probe digests assembled inline) so they can opt into
 * the same single-pass redaction without duplicating logic.
 */
export function applySanitizer(payload: string): string {
  return redact(payload);
}
