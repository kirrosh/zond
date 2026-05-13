/**
 * ARV-169 (m-20): POST→GET cross-call drift diff logic.
 *
 * The check creates a resource, reads it back, and compares the
 * write-shape (what the client sent + what the create response echoed)
 * against the read-shape (what GET returned). Three flavours of drift:
 *
 *   • write-only — POST accepted the field, GET never returned it.
 *     Often a secret/write-once design; can also be a silent data drop.
 *     Suppressible via `ignore_fields` per resource.
 *   • state-not-persisted — POST *echoed* the field in its 2xx response
 *     but GET dropped it. This is the high-signal class: server lied
 *     about persisting state. Always HIGH unless explicitly ignored.
 *   • undeclared-on-read — GET returned a field the spec doesn't
 *     document. Surfaced by response_schema_conformance already; this
 *     check is the cross-call analogue and stays out of the way.
 *
 * Anti-FP: a baseline `DEFAULT_READBACK_IGNORE` filters timestamp/etag
 * envelope fields shared across every SaaS API, so a probe on a stock
 * spec without yaml overrides doesn't drown in noise. Per-API quirks
 * (Stripe `metadata` stripping, `livemode`) are layered on top via
 * `.api-resources.local.yaml` (authored by `zond api annotate` or by
 * hand — see backlog/notes/m-20-validation.md §«Review boundary»).
 */
import type { ReadbackDiffConfig } from "../../generator/resources-builder.ts";

/** Fields excluded from drift detection on every resource, regardless
 *  of yaml config. These are universally non-comparable across the
 *  POST→GET hop. */
export const DEFAULT_READBACK_IGNORE: ReadonlySet<string> = new Set([
  "id",
  "object",
  "created",
  "created_at",
  "createdAt",
  "updated",
  "updated_at",
  "updatedAt",
  "deleted_at",
  "etag",
  "_etag",
  "version",
  "livemode",
  "_links",
  "self",
  "url",
]);

export interface DriftField {
  field: string;
  kind: "write_only" | "state_not_persisted" | "undeclared_on_read";
  /** For state_not_persisted: the value the create response echoed. */
  writtenValue?: unknown;
}

export interface DriftReport {
  writeOnly: DriftField[];
  stateNotPersisted: DriftField[];
  undeclaredOnRead: DriftField[];
}

function shallowFields(v: unknown): Set<string> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return new Set();
  return new Set(Object.keys(v as Record<string, unknown>));
}

/**
 * Compute drift between write-shape and read-shape.
 *
 * @param writeBody   what the client POSTed (parsed JSON)
 * @param createEcho  the 2xx response body of the POST
 * @param readBody    the 2xx response body of the subsequent GET
 * @param specDeclared field names declared in spec.responses for the GET
 *                     (used to suppress write-only fields that the spec
 *                     marks as write-only — `password`-style secrets).
 *                     Empty Set ⇒ no suppression by spec.
 * @param cfg         per-resource readback overrides
 */
export function computeDrift(
  writeBody: unknown,
  createEcho: unknown,
  readBody: unknown,
  specDeclared: ReadonlySet<string>,
  cfg: ReadbackDiffConfig | undefined,
): DriftReport {
  const writeFields = shallowFields(writeBody);
  const echoFields = shallowFields(createEcho);
  const readFields = shallowFields(readBody);

  const ignore = new Set<string>(DEFAULT_READBACK_IGNORE);
  for (const f of cfg?.ignoreFields ?? []) ignore.add(f);
  const renameMap = cfg?.writeToReadMap ?? {};

  // Apply rename: a write-side field maps to a different read-side name.
  const writeAfterRename = new Set<string>();
  for (const f of writeFields) writeAfterRename.add(renameMap[f] ?? f);
  const echoAfterRename = new Set<string>();
  for (const f of echoFields) echoAfterRename.add(renameMap[f] ?? f);

  const writeOnly: DriftField[] = [];
  for (const f of writeAfterRename) {
    if (ignore.has(f)) continue;
    if (readFields.has(f)) continue;
    // If the field isn't declared on the GET response schema at all,
    // it's a write-only-by-spec contract — not a drift. (Secrets, etc.)
    if (specDeclared.size > 0 && !specDeclared.has(f)) continue;
    writeOnly.push({ field: f, kind: "write_only" });
  }

  const stateNotPersisted: DriftField[] = [];
  const echoBody = (createEcho ?? {}) as Record<string, unknown>;
  for (const f of echoAfterRename) {
    if (ignore.has(f)) continue;
    if (readFields.has(f)) continue;
    // Only report fields the echo actually carried with a non-null value —
    // a null echo is the server signalling "not set", not a persistence bug.
    const originalKey = Object.keys(renameMap).find((k) => renameMap[k] === f) ?? f;
    const v = echoBody[originalKey];
    if (v === undefined || v === null) continue;
    stateNotPersisted.push({ field: f, kind: "state_not_persisted", writtenValue: v });
  }

  const undeclaredOnRead: DriftField[] = [];
  if (specDeclared.size > 0) {
    for (const f of readFields) {
      if (ignore.has(f)) continue;
      if (specDeclared.has(f)) continue;
      undeclaredOnRead.push({ field: f, kind: "undeclared_on_read" });
    }
  }

  return { writeOnly, stateNotPersisted, undeclaredOnRead };
}
