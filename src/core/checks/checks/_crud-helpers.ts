/**
 * Shared id-extraction helpers for stateful CRUD checks (m-15 ARV-3).
 * Kept under `_` prefix so it doesn't get auto-registered.
 */
import { encodeFormBody } from "../../runner/form-encode.ts";
import { substituteDeep } from "../../parser/variables.ts";
import { generateFromSchema } from "../../generator/data-factory.ts";
import type { EndpointInfo } from "../../generator/types.ts";
import type { SeedBodyConfig } from "../../generator/resources-builder.ts";

/**
 * ARV-187: pick the create body for a stateful CRUD step. Prefers an
 * LLM-authored `seed_body` block (from `.api-resources.local.yaml`)
 * because random scalars from `generateFromSchema` consistently get
 * rejected by strict-validating APIs (Stripe's `expand[]`, Stripe
 * required-field XORs, FK-bearing creates). When no seed_body is set,
 * falls back to generation — preserves the pre-ARV-187 behaviour for
 * APIs we haven't annotated yet.
 *
 * Returns `null` when neither path can produce an object (no schema +
 * no seed). Caller should skip with a broken-baseline reason.
 */
export function resolveCreateBody(
  create: EndpointInfo,
  seedBody: SeedBodyConfig | undefined,
): Record<string, unknown> | null {
  if (seedBody && seedBody.body && typeof seedBody.body === "object") {
    return seedBody.body;
  }
  if (!create.requestBodySchema) return null;
  const generated = generateFromSchema(create.requestBodySchema);
  if (generated == null || typeof generated !== "object") return null;
  return generated as Record<string, unknown>;
}

/**
 * ARV-191: serialise a generated body using whichever wire format the
 * create endpoint declares, and resolve the `{{$randomString}}` /
 * `{{$randomInt}}` / `{{$randomEmail}}` markers that
 * `generateFromSchema` embeds. Two failure modes this addresses:
 *
 *   1. Content-type — Stripe-style APIs declare only
 *      `application/x-www-form-urlencoded`; JSON.stringify yields a
 *      400 "missing required param" the broken-baseline guard swallows.
 *      Mirrors `serializeProbeBody` (ARV-150) for probes.
 *   2. Placeholder resolution — `data-factory` emits literal markers
 *      that downstream callers (the YAML runner, the probe-harness)
 *      resolve via `substituteDeep`. Stateful checks bypassed this and
 *      sent `balance={{$randomInt}}` to Stripe → 400. Sending JSON
 *      previously masked the bug because Stripe ignored the body
 *      entirely on form-encoded endpoints.
 *
 * Pass `vars` when the caller has live env values (path-fixtures); the
 * helper otherwise relies on the built-in `GENERATORS` table inside
 * `substituteDeep` to fabricate values for the random markers.
 */
export function serializeCheckBody(
  create: { requestBodyContentType?: string },
  body: Record<string, unknown>,
  vars: Record<string, unknown> = {},
  contentTypeOverride?: string,
): { body: string; contentType: string } {
  const resolved = substituteDeep(body, vars);
  const obj = (resolved && typeof resolved === "object" && !Array.isArray(resolved))
    ? (resolved as Record<string, unknown>)
    : {};
  const ct = contentTypeOverride ?? create.requestBodyContentType ?? "application/json";
  if (ct === "application/x-www-form-urlencoded") {
    return { body: encodeFormBody(obj), contentType: "application/x-www-form-urlencoded" };
  }
  return { body: JSON.stringify(obj), contentType: ct };
}

export function fillPathWithId(path: string, idParam: string, id: string | number): string {
  const v = encodeURIComponent(String(id));
  return path
    .replace(new RegExp(`\\{${idParam}\\}`), v)
    // Fallback: any single placeholder gets replaced.
    .replace(/\{[^}]+\}/g, v);
}

/** ARV-169: substitute parent-scope path-params on a create endpoint
 *  using harness.pathVars. Resource-scoped APIs (Sentry's
 *  `/api/0/organizations/{organization_id_or_slug}/projects/`) need
 *  the parent id resolved before the create call lands — without it
 *  the create 404s and the broken-baseline guard skips the whole
 *  CRUD chain. Vars not present in `pathVars` are left as literal
 *  placeholders so the caller can spot the gap in skip diagnostics.
 *  Idempotent for paths with no placeholders (most flat-CRUD APIs). */
export function fillPathParams(path: string, pathVars?: Record<string, string>): string {
  if (!pathVars) return path;
  return path.replace(/\{([^}]+)\}/g, (_, name) => {
    const v = pathVars[name];
    return v && v.length > 0 ? encodeURIComponent(v) : `{${name}}`;
  });
}

/**
 * Pull a usable id out of a create-response body. Honours the spec's
 * declared `idParam` first (so `userId` matches `user_id` / `userId`),
 * then falls back to a list of common keys. Returns null if nothing
 * looks like a usable id.
 */
export function extractIdFromCreateResponse(body: unknown, idParam: string): string | number | null {
  if (body == null || typeof body !== "object") {
    if (typeof body === "string" || typeof body === "number") return body;
    return null;
  }
  // Strings often arrive as parsed JSON via http-client; treat both.
  const obj = body as Record<string, unknown>;
  const candidates = [
    idParam,
    idParam.replace(/[_-]/g, ""),
    "id",
    "uuid",
    "slug",
    "name",
    "key",
  ];
  for (const k of candidates) {
    const v = obj[k];
    if (typeof v === "string" || typeof v === "number") return v;
  }
  // common SaaS-style { data: { id } } envelope.
  const data = obj.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object") {
    for (const k of candidates) {
      const v = data[k];
      if (typeof v === "string" || typeof v === "number") return v;
    }
  }
  return null;
}
