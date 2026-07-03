/**
 * `zond probe webhooks` (m-20 ARV-173) — webhook shape-conformance.
 *
 * The probe is **offline**: it reads an ndjson event log captured by
 * the recipe (`docs/recipes/webhook-receiver.md`, e.g. via
 * `stripe listen --print-json`) and validates each event payload
 * against the schema declared in `spec.webhooks.<event>.post.requestBody`.
 *
 * Why offline? m-20 explicitly puts live HTTP infrastructure (tunnels,
 * port binding, receiver servers) in recipes, not core zond:
 *
 *   • A live receiver requires a public URL — that's a recipe concern
 *     (Stripe CLI, ngrok, smee.io are all out-of-band).
 *   • Capture is bursty (events trickle in seconds-to-minutes after a
 *     trigger); the probe can't reliably wait for them inside a CLI
 *     invocation without nasty timeout knobs.
 *   • Decoupling capture from verification lets the same probe run
 *     against logs from prod tap, mitm-proxy dumps, CI artifacts, etc.
 *
 * Recipe captures; probe verifies. Same pattern as quicktype (capture
 * → schema infer) and interactsh (capture → OOB-detect) in m-18.
 *
 * Event log format: ndjson, one event per line. Two recognised shapes:
 *
 *   • Stripe-style — `{type, data: {object: {...}}}` (the payload is
 *     `data.object`; everything else is envelope metadata).
 *   • Generic — `{type|event, body|payload, ...}` (the payload is
 *     whichever of `body`/`payload` is an object; falls back to the
 *     event itself when neither is present).
 *
 * Severity policy: HIGH on shape drift (server announced an event
 * shape via `webhooks:` and is now sending something else). Unknown
 * event types and missing payloads surface at LOW — they're noise
 * categories, not contract bugs the API owner promised against.
 */
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import type { ValidateFunction, ErrorObject } from "ajv";
import { makeAjv } from "../util/ajv.ts";

interface SingleSchemaValidator {
  validate(value: unknown): boolean;
  errors: ErrorObject[] | null;
}

/** Compile a single JSON-Schema-shaped object into a callable validator.
 *  3.1-flavour by default (`webhooks:` is OpenAPI 3.1) but tolerates
 *  pre-3.1 specs using `x-webhooks` — they ship Draft-7-ish schemas. */
function compileSingleSchema(schema: OpenAPIV3.SchemaObject, isV31: boolean): SingleSchemaValidator {
  const ajv = makeAjv(isV31, { strict: false, allErrors: true });
  const validate: ValidateFunction = ajv.compile(schema);
  return {
    validate(value) { return validate(value) as boolean; },
    get errors() { return validate.errors ?? null; },
  };
}

export type WebhookFindingKind =
  | "shape_drift"
  | "unknown_event_type"
  | "missing_payload"
  | "malformed_event";

export interface WebhookFinding {
  /** Line number in the event log (1-indexed) for traceability. */
  line: number;
  kind: WebhookFindingKind;
  severity: "high" | "low";
  event_type: string | null;
  message: string;
  evidence: Record<string, unknown>;
  /** ARV-311: set when `.zond/severity.yaml` suppressed this finding. */
  suppressed_by?: { source: string; rule_index: number; reason: string };
}

export interface WebhookProbeResult {
  total_events: number;
  by_type: Record<string, { ok: number; drift: number; unknown: number }>;
  declared_events: string[];
  findings: WebhookFinding[];
  /** Reason the probe short-circuited without inspecting any event,
   *  e.g. spec has no webhooks block. Empty string when normal. */
  skip_reason: string;
}

/** Extract the webhooks block. Tries OpenAPI 3.1 `webhooks:` first
 *  (the canonical location), falls back to `x-webhooks` for specs
 *  shipped before OpenAPI 3.1 had ratified the field. Returns an
 *  empty object when neither exists. */
export function readWebhooksMap(spec: unknown): Record<string, OpenAPIV3.PathItemObject> {
  if (!spec || typeof spec !== "object") return {};
  const s = spec as Record<string, unknown>;
  const candidate = (s.webhooks ?? s["x-webhooks"]) as Record<string, OpenAPIV3.PathItemObject> | undefined;
  if (!candidate || typeof candidate !== "object") return {};
  return candidate;
}

/** Pull the request-body schema for the POST operation under a
 *  webhook entry. Returns null when the entry doesn't declare a POST,
 *  or when the POST doesn't carry a JSON requestBody schema. */
function schemaForEvent(item: OpenAPIV3.PathItemObject | OpenAPIV3_1.PathItemObject): OpenAPIV3.SchemaObject | null {
  const post = item.post;
  if (!post) return null;
  const rb = post.requestBody;
  if (!rb || (rb as OpenAPIV3.ReferenceObject).$ref) return null;
  const content = (rb as OpenAPIV3.RequestBodyObject).content ?? {};
  const json = content["application/json"];
  if (!json?.schema) return null;
  return json.schema as OpenAPIV3.SchemaObject;
}

/** Extract `type` from an event in a tolerant way: try `type` first
 *  (Stripe / GitHub style), then `event` (legacy / SaaS-style), then
 *  give up. Numbers are coerced to strings so an integer-valued
 *  `type` field doesn't masquerade as null. */
function readEventType(event: Record<string, unknown>): string | null {
  for (const k of ["type", "event", "event_type"]) {
    const v = event[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** Extract the payload from an event. Recognised envelopes (in
 *  priority order): `data.object` (Stripe), `body`, `payload`. Returns
 *  null when none of those carry an object — missing_payload then
 *  surfaces as a LOW finding so the operator can fix the capture
 *  step (and the probe doesn't validate envelope metadata as payload). */
function readEventPayload(event: Record<string, unknown>): unknown {
  if (event.data && typeof event.data === "object" && !Array.isArray(event.data)) {
    const inner = (event.data as Record<string, unknown>).object;
    if (inner && typeof inner === "object") return inner;
  }
  for (const k of ["body", "payload"]) {
    const v = event[k];
    if (v && typeof v === "object") return v;
  }
  return null;
}

export interface RunOptions {
  /** Pre-parsed events. One Record per line; non-object lines should
   *  surface as malformed_event findings before reaching this layer. */
  events: Array<{ line: number; event: Record<string, unknown> }>;
  spec: unknown;
  /** Optional restriction — only validate events whose `type` is in
   *  this list. Empty/undefined ⇒ validate everything declared. */
  onlyTypes?: string[];
}

export function runWebhooksProbe(opts: RunOptions): WebhookProbeResult {
  const webhooksMap = readWebhooksMap(opts.spec);
  const declared = Object.keys(webhooksMap).sort();

  const out: WebhookProbeResult = {
    total_events: opts.events.length,
    by_type: {},
    declared_events: declared,
    findings: [],
    skip_reason: "",
  };

  if (declared.length === 0) {
    out.skip_reason = "spec declares no `webhooks:` (or `x-webhooks`) entries — nothing to validate against";
    return out;
  }

  const isV31 = typeof (opts.spec as { openapi?: string })?.openapi === "string"
    && (opts.spec as { openapi: string }).openapi.startsWith("3.1");
  // Compile each schema once; events sharing a type reuse the validator.
  const validators = new Map<string, SingleSchemaValidator | null>();
  for (const [name, item] of Object.entries(webhooksMap)) {
    const schema = schemaForEvent(item);
    if (!schema) { validators.set(name, null); continue; }
    try {
      validators.set(name, compileSingleSchema(schema, isV31));
    } catch {
      validators.set(name, null);
    }
  }

  const onlyTypes = opts.onlyTypes && opts.onlyTypes.length > 0 ? new Set(opts.onlyTypes) : null;

  for (const { line, event } of opts.events) {
    const type = readEventType(event);
    if (!type) {
      out.findings.push({
        line, kind: "malformed_event", severity: "low",
        event_type: null,
        message: `event has no recognisable type field (tried "type", "event", "event_type")`,
        evidence: { event_keys: Object.keys(event) },
      });
      continue;
    }
    if (onlyTypes && !onlyTypes.has(type)) continue;
    const bucket = out.by_type[type] ?? (out.by_type[type] = { ok: 0, drift: 0, unknown: 0 });
    const validator = validators.get(type);
    if (validator === undefined) {
      bucket.unknown += 1;
      out.findings.push({
        line, kind: "unknown_event_type", severity: "low",
        event_type: type,
        message: `event type "${type}" is not declared in spec.webhooks (${declared.length} declared)`,
        evidence: { declared_sample: declared.slice(0, 5) },
      });
      continue;
    }
    if (validator === null) {
      // Declared but no schema to validate against → silent pass for
      // that event type; surfacing every such case would be noise.
      bucket.ok += 1;
      continue;
    }
    const payload = readEventPayload(event);
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
      out.findings.push({
        line, kind: "missing_payload", severity: "low",
        event_type: type,
        message: `event "${type}" carries no object payload (data.object / body / payload)`,
        evidence: { event_keys: Object.keys(event) },
      });
      continue;
    }
    const valid = validator.validate(payload);
    if (valid) { bucket.ok += 1; continue; }
    bucket.drift += 1;
    const errs = validator.errors ?? [];
    out.findings.push({
      line, kind: "shape_drift", severity: "high",
      event_type: type,
      message: `event "${type}" does not conform to declared schema (${errs.length} error(s))`,
      evidence: {
        errors: errs.slice(0, 5).map((e) => ({
          path: e.instancePath ?? "",
          keyword: e.keyword ?? "",
          message: e.message ?? "",
          params: e.params ?? {},
        })),
      },
    });
  }
  return out;
}

/** Parse an ndjson event log. Each line that is non-empty and parses
 *  to an object yields one `{line, event}`. Bad lines surface as
 *  malformed_event findings in the result so the operator gets
 *  pinpointed feedback. */
export function parseEventLog(text: string): {
  events: Array<{ line: number; event: Record<string, unknown> }>;
  malformed: WebhookFinding[];
} {
  const events: Array<{ line: number; event: Record<string, unknown> }> = [];
  const malformed: WebhookFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw.length === 0) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        events.push({ line: i + 1, event: parsed as Record<string, unknown> });
      } else {
        malformed.push({
          line: i + 1, kind: "malformed_event", severity: "low",
          event_type: null,
          message: `event line is not a JSON object`,
          evidence: { sample: raw.slice(0, 60) },
        });
      }
    } catch (e) {
      malformed.push({
        line: i + 1, kind: "malformed_event", severity: "low",
        event_type: null,
        message: `ndjson parse failed: ${(e as Error).message}`,
        evidence: { sample: raw.slice(0, 60) },
      });
    }
  }
  return { events, malformed };
}
