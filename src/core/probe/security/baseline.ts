import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import { executeRequest } from "../../runner/http-client.ts";
import { findGetByIdCounterpart, liveAuthHeaders } from "../shared.ts";
import { buildProbeUrl, serializeProbeBody } from "../probe-harness.ts";
import type { ProbeStepOpts, SecurityVerdict } from "./types.ts";

export interface Snapshot {
  /** Original GET-response body, used to restore state via PUT/PATCH. */
  body: Record<string, unknown>;
  /** ETag (if API uses optimistic locking) — sent back as `If-Match` on restore. */
  etag?: string;
}

export type BaselineResult =
  | { kind: "ok"; status: number; body: unknown; headers: Record<string, string> }
  | { kind: "network"; reason: string };

/**
 * Baseline send — wraps executeRequest with shape that distinguishes a real
 * HTTP response from a network error (so the caller can decide whether to
 * retry partial-body / mark the endpoint unreachable).
 */
export async function sendBaseline(
  ep: EndpointInfo,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: ProbeStepOpts,
): Promise<BaselineResult> {
  try {
    // ARV-161: serialize via serializeProbeBody so form-encoded endpoints
    // get x-www-form-urlencoded payload matching Content-Type.
    const wire = body && typeof body === "object" && !Array.isArray(body)
      ? serializeProbeBody(ep, body as Record<string, unknown>).content
      : JSON.stringify(body);
    const resp = await executeRequest(
      { method, url, headers, body: wire },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
    return {
      kind: "ok",
      status: resp.status,
      body: resp.body_parsed ?? resp.body,
      headers: resp.headers ?? {},
    };
  } catch (err) {
    return {
      kind: "network",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * TASK-151: snapshot original state via GET-by-id counterpart so PUT/PATCH
 * attacks can be undone. Returns null when there's no usable counterpart
 * or the response isn't a JSON object.
 */
export async function snapshotOriginal(
  ep: EndpointInfo,
  allEndpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  opts: ProbeStepOpts,
): Promise<Snapshot | null> {
  const getEp = findGetByIdCounterpart(ep, allEndpoints);
  if (!getEp) return null;
  const { url, unresolved } = buildProbeUrl(getEp, vars);
  if (unresolved.length > 0) return null;
  const reqHeaders: Record<string, string> = {
    accept: "application/json",
    ...liveAuthHeaders(getEp, schemes, vars),
  };
  let resp;
  try {
    resp = await executeRequest(
      { method: "GET", url, headers: reqHeaders },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
  } catch {
    return null;
  }
  if (resp.status < 200 || resp.status >= 300) return null;
  const body = resp.body_parsed ?? resp.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const respHeaders = resp.headers ?? {};
  const etag =
    respHeaders["etag"] ??
    respHeaders["ETag"] ??
    respHeaders["Etag"];

  return {
    body: body as Record<string, unknown>,
    etag: typeof etag === "string" ? etag : undefined,
  };
}

/**
 * Restore the original state captured by `snapshotOriginal`. Sends a
 * minimal PUT/PATCH containing only the fields the probe mutated —
 * sending the full snapshot body trips `422 use partial PUT` on
 * SaaS-shaped APIs (round-4 regression), so we replay each
 * dirty field as its own single-key request.
 *
 * `verdict.cleanup.error` is **accumulated** across calls (not
 * overwritten) so a single restore failure during the run is still
 * visible in the digest.
 */
export async function restoreOriginal(
  ep: EndpointInfo,
  snapshot: Snapshot,
  baseHeaders: Record<string, string>,
  _schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  opts: ProbeStepOpts,
  verdict: SecurityVerdict,
  dirtyFields: Iterable<string>,
): Promise<void> {
  const m = ep.method.toUpperCase();
  const { url, unresolved } = buildProbeUrl(ep, vars);
  if (unresolved.length > 0) return;
  const headers: Record<string, string> = { ...baseHeaders };
  if (snapshot.etag && ep.requiresEtag) {
    headers["If-Match"] = snapshot.etag;
  }
  // Filter out fields the API will reject as read-only.
  const READ_ONLY = new Set([
    "id", "created_at", "createdAt", "updated_at", "updatedAt",
  ]);
  const fields = Array.from(new Set(Array.from(dirtyFields))).filter(
    f => !READ_ONLY.has(f) && f in snapshot.body,
  );

  // Per-field PUT — works for both partial-PUT APIs and
  // full-PUT APIs (the body just carries one of the legal keys).
  const failures: string[] = [];
  let lastSuccessStatus = 0;
  let attempted = false;
  for (const field of fields) {
    attempted = true;
    const body: Record<string, unknown> = { [field]: snapshot.body[field] };
    let resp;
    try {
      resp = await executeRequest(
        { method: m, url, headers, body: serializeProbeBody(ep, body).content },
        { timeout: opts.timeoutMs ?? 30000, retries: 0 },
      );
    } catch (err) {
      failures.push(
        `restore.${field} network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (resp.status < 200 || resp.status >= 300) {
      failures.push(`restore.${field} failed: ${resp.status}`);
      continue;
    }
    lastSuccessStatus = resp.status;
  }

  // Merge with any prior cleanup state on this verdict.
  const prior = verdict.cleanup ?? { attempted: false };
  const allErrors = [
    ...(prior.error ? [prior.error] : []),
    ...failures,
  ];
  verdict.cleanup = {
    attempted: attempted || prior.attempted,
    ...(lastSuccessStatus ? { status: lastSuccessStatus } : prior.status ? { status: prior.status } : {}),
    ...(allErrors.length > 0 ? { error: allErrors.join(" | ") } : {}),
  };
}
