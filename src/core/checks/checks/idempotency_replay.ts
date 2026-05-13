/**
 * `idempotency_replay` (m-20 ARV-170) — Idempotency-Key honor probe.
 *
 * For each CRUD group with create+delete where idempotency is opted-in
 * (either via `.api-resources.yaml` `idempotency:` block or by the
 * create endpoint declaring an `Idempotency-Key` header parameter),
 * POST the same body twice with the same key. The server must:
 *
 *   1. return the *same* resource id on both calls (id1 == id2 — no
 *      duplicate created), AND
 *   2. return bit-identical responses modulo a small allow-list of
 *      timestamp / request-id fields (R1 == R2).
 *
 * Severity policy: HIGH. The two failure classes share one finding —
 * the runner doesn't support per-finding severity downgrade and
 * `duplicate_resource` is the dominant signal anyway. `non_bit_identical`
 * piggybacks via finding.evidence.kind so consumers can split the
 * digest if they care.
 *
 * Anti-FP guards:
 *   • Skip when the second POST gets a 429 / 409 / 5xx — replay rate
 *     limiting and locking races confuse the verdict.
 *   • Skip when either POST fails the broken-baseline check (non-2xx).
 *   • Cleanup tolerates missing DELETE wiring — emits a warning via
 *     `cleanup_warning` in evidence.
 *
 * Auto-detect fallback: if no yaml block exists but the create endpoint
 * declares an `Idempotency-Key` header in its `parameters[]`, the check
 * runs with default settings. Explicit yaml wins — it lets the user
 * override the header name and customize the ignore list.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { CrudStatefulCheck } from "../stateful.ts";
import type { IdempotencyConfig } from "../../generator/resources-builder.ts";
import { generateFromSchema } from "../../generator/data-factory.ts";
import { extractIdFromCreateResponse, fillPathWithId, fillPathParams, serializeCheckBody } from "./_crud-helpers.ts";

/** Default header name used when yaml omits it and we're running on
 *  spec-detected idempotency support. Matches the Stripe / Resend
 *  convention; specs that use a different casing should declare it
 *  explicitly. */
const DEFAULT_HEADER = "Idempotency-Key";

/** Baseline response fields stripped before bit-identical compare.
 *  Mirrors the readback-diff baseline minus a few read-shape-specific
 *  ones (livemode, _links). Timestamps + request-id + etag cover the
 *  common "every replay has a new request_id" surface. */
const DEFAULT_IGNORE_RESPONSE: ReadonlySet<string> = new Set([
  "created",
  "created_at",
  "createdAt",
  "updated",
  "updated_at",
  "updatedAt",
  "request_id",
  "requestId",
  "x_request_id",
  "etag",
  "_etag",
]);

function safeParse(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function detectSpecHeader(create: { parameters: OpenAPIV3.ParameterObject[] }): string | null {
  for (const p of create.parameters) {
    if (p.in !== "header") continue;
    if (p.name.toLowerCase() === "idempotency-key") return p.name;
  }
  return null;
}

function resolveConfig(
  cfg: IdempotencyConfig | undefined,
  create: { parameters: OpenAPIV3.ParameterObject[] },
): { header: string; ignore: ReadonlySet<string> } | null {
  if (cfg) {
    const header = cfg.header ?? DEFAULT_HEADER;
    const ignore = cfg.ignoreResponseFields
      ? new Set<string>([...DEFAULT_IGNORE_RESPONSE, ...cfg.ignoreResponseFields])
      : DEFAULT_IGNORE_RESPONSE;
    return { header, ignore };
  }
  const detected = detectSpecHeader(create);
  if (detected) return { header: detected, ignore: DEFAULT_IGNORE_RESPONSE };
  return null;
}

/** Shallow object diff with field-level ignore. Returns the list of
 *  keys whose values differ (or whose presence differs) between a and
 *  b, excluding ignored fields. Both inputs treated as `{}` when not
 *  object-shaped. */
function diffFields(a: unknown, b: unknown, ignore: ReadonlySet<string>): string[] {
  const av = (a && typeof a === "object" && !Array.isArray(a)) ? (a as Record<string, unknown>) : {};
  const bv = (b && typeof b === "object" && !Array.isArray(b)) ? (b as Record<string, unknown>) : {};
  const keys = new Set<string>([...Object.keys(av), ...Object.keys(bv)]);
  const diffs: string[] = [];
  for (const k of keys) {
    if (ignore.has(k)) continue;
    const sa = JSON.stringify(av[k] ?? null);
    const sb = JSON.stringify(bv[k] ?? null);
    if (sa !== sb) diffs.push(k);
  }
  return diffs;
}

function generateKey(): string {
  // Bun + Node 19+ ship crypto.randomUUID; fall back to a timestamp+rand
  // mash so tests on minimal stubs still produce a stable-ish key.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `zond-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const idempotencyReplay: CrudStatefulCheck = {
  id: "idempotency_replay",
  severity: "high",
  defaultExpected: "Two POSTs with the same Idempotency-Key must return the same resource id and bit-identical responses",
  references: [{ id: "ARV-170" }, { id: "stripe-idempotent-requests" }],
  phase: "crud",
  applies(g) {
    return Boolean(g.create);
  },
  async run(g, h) {
    if (h.bootstrapCleanupFailed) {
      return { kind: "skip", reason: "bootstrap-cleanup failed — stateful checks paused" };
    }
    const create = g.create!;

    const cfg = h.resourceConfigs?.get(g.resource)?.idempotency;
    const resolved = resolveConfig(cfg, create);
    if (!resolved) {
      return { kind: "skip", reason: "no idempotency config and no Idempotency-Key parameter in spec" };
    }

    if (!create.requestBodySchema) {
      return { kind: "skip", reason: "create has no requestBody schema — nothing to replay" };
    }
    const writeBody = generateFromSchema(create.requestBodySchema);
    if (writeBody == null || typeof writeBody !== "object") {
      return { kind: "skip", reason: "generated create body is not an object" };
    }

    const key = generateKey();
    // ARV-191: form-urlencoded vs JSON dispatch — Stripe-style APIs
    // honor Idempotency-Key but expect x-www-form-urlencoded payloads;
    // JSON.stringify would yield broken-baseline 400s on every replay.
    const { body: bodyStr, contentType } = serializeCheckBody(create, writeBody as Record<string, unknown>, h.pathVars);
    const baseHeaders = {
      Accept: "application/json",
      "Content-Type": contentType,
      [resolved.header]: key,
      ...h.authHeaders,
    };
    const url = `${h.baseUrl.replace(/\/+$/, "")}${fillPathParams(create.path, h.pathVars)}`;

    // 1st POST
    const r1 = await h.send({ method: "POST", url, headers: baseHeaders, body: bodyStr });
    if (r1.status < 200 || r1.status >= 300) {
      return { kind: "skip", reason: `1st create returned ${r1.status} — broken-baseline guard` };
    }
    const body1 = r1.body_parsed ?? safeParse(r1.body);
    const id1 = extractIdFromCreateResponse(body1, g.idParam);
    if (id1 == null) return { kind: "skip", reason: "could not extract id from 1st create response" };

    // 2nd POST — same body, same key
    const r2 = await h.send({ method: "POST", url, headers: baseHeaders, body: bodyStr });
    if (r2.status === 429 || r2.status === 409) {
      // Cleanup r1 before bailing — we did create something.
      await tryCleanup(g, h, id1);
      return { kind: "skip", reason: `2nd create returned ${r2.status} — rate-limit/conflict, replay verdict ambiguous` };
    }
    if (r2.status < 200 || r2.status >= 300) {
      await tryCleanup(g, h, id1);
      return { kind: "skip", reason: `2nd create returned ${r2.status} — broken-baseline guard` };
    }
    const body2 = r2.body_parsed ?? safeParse(r2.body);
    const id2 = extractIdFromCreateResponse(body2, g.idParam);

    // Verdict
    const duplicate = id2 != null && String(id1) !== String(id2);
    const diffs = duplicate ? [] : diffFields(body1, body2, resolved.ignore);
    const nonBitIdentical = !duplicate && diffs.length > 0;

    // Cleanup. If duplicate, both ids need to go.
    const cleanupWarn: string[] = [];
    const okCleanup1 = await tryCleanup(g, h, id1);
    if (!okCleanup1) cleanupWarn.push(`failed to DELETE id=${id1}`);
    if (duplicate && id2 != null) {
      const okCleanup2 = await tryCleanup(g, h, id2);
      if (!okCleanup2) cleanupWarn.push(`failed to DELETE id=${id2}`);
    }

    if (!duplicate && !nonBitIdentical) {
      return { kind: "pass" };
    }

    const kind = duplicate && nonBitIdentical
      ? "both"
      : duplicate ? "duplicate_resource" : "non_bit_identical";
    const message = duplicate
      ? `Idempotency-Key not honored on ${g.resource}: replay produced a new resource (id1=${id1}, id2=${id2})`
      : `Idempotency-Key replay on ${g.resource} is not bit-identical (${diffs.length} field(s) differ): ${diffs.slice(0, 5).join(", ")}`;

    return {
      kind: "fail",
      message,
      evidence: {
        resource: g.resource,
        kind,
        header: resolved.header,
        key,
        id1,
        id2,
        diff_fields: diffs,
        ...(cleanupWarn.length > 0 ? { cleanup_warning: cleanupWarn } : {}),
      },
    };
  },
};

async function tryCleanup(
  g: { delete?: { path: string }; idParam: string },
  h: import("../stateful.ts").StatefulHarness,
  id: string | number,
): Promise<boolean> {
  if (!g.delete) return false;
  const url = `${h.baseUrl.replace(/\/+$/, "")}${fillPathWithId(fillPathParams(g.delete.path, h.pathVars), g.idParam, id)}`;
  try {
    const resp = await h.send({
      method: "DELETE",
      url,
      headers: { Accept: "application/json", ...h.authHeaders },
    });
    // 404 = already gone (good); 2xx = deleted; anything else = failure.
    return resp.status === 404 || (resp.status >= 200 && resp.status < 300);
  } catch {
    return false;
  }
}
