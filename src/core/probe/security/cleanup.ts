import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import { executeRequest } from "../../runner/http-client.ts";
import {
  captureFieldFor,
  findDeleteCounterpart,
  liveAuthHeaders,
} from "../shared.ts";
import type { ProbeStepOpts, SecurityVerdict } from "./types.ts";

/**
 * Best-effort DELETE on stateful endpoints after a successful baseline /
 * attack. Handles eventual-consistency retries (round-5) and persists
 * id/deletePath on the verdict so `zond cleanup --orphans` can replay
 * the DELETE without re-running the probe.
 */
export async function tryCleanup(
  ep: EndpointInfo,
  allEndpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  responseBody: unknown,
  verdict: SecurityVerdict,
  opts: ProbeStepOpts,
): Promise<void> {
  const delEp = findDeleteCounterpart(ep, allEndpoints);
  if (!delEp) {
    // Surface the gap. Round-4 dogfooding: 3 DSN keys leaked from
    // POST /keys/ silently because the spec didn't expose a DELETE
    // counterpart — flagging it in the digest gives the operator a
    // chance to clean up by hand instead of finding out later.
    accumulateCleanupError(verdict, `no DELETE counterpart for ${ep.method.toUpperCase()} ${ep.path}; possible leaked resource`);
    return;
  }
  const idField = captureFieldFor(ep);
  const id = pickId(responseBody, idField);
  if (!id) {
    accumulateCleanupError(verdict, `cleanup skipped: response had no usable id for ${ep.method.toUpperCase()} ${ep.path}`);
    return;
  }
  // DELETE path has one path-param at the end; replace it with the captured id.
  const concretePath = delEp.path.replace(/\{[^}]+\}/, encodeURIComponent(String(id)));
  const url = `${(vars["base_url"] ?? "").replace(/\/+$/, "")}${concretePath}`;
  const headers = liveAuthHeaders(delEp, schemes, vars);

  // TASK-278: stash id + deletePath on the verdict so the orphan tracker
  // (and `zond cleanup --orphans`) can replay this DELETE without re-running
  // the probe. Done before retries so even an aborted run leaves a trace.
  {
    const prior = verdict.cleanup ?? { attempted: false };
    verdict.cleanup = {
      ...prior,
      attempted: prior.attempted || true,
      id,
      deletePath: concretePath,
    };
  }

  // Eventual-consistency retry (round-5 follow-up): POST creates on the
  // write replica, immediate DELETE hits a read replica that hasn't seen
  // the new id yet → 404. Two short backoffs swallow that transient
  // 404; a 404 that survives the backoff is a real leak and lands in
  // verdict.cleanup.error. Only 404 is retried — 5xx, network errors,
  // 401/403 fail fast (the situation isn't going to improve).
  const RETRY_DELAYS_MS = opts.cleanupRetryDelaysMs ?? [200, 1000];
  let lastResp: { status: number } | null = null;
  let lastNetErr: string | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]!));
    try {
      const resp = await executeRequest(
        { method: "DELETE", url, headers },
        { timeout: opts.timeoutMs ?? 30000, retries: 0 },
      );
      lastResp = { status: resp.status };
      if (resp.status >= 200 && resp.status < 300) {
        const prior = verdict.cleanup ?? { attempted: false };
        verdict.cleanup = {
          attempted: true,
          status: resp.status,
          ...(prior.error ? { error: prior.error } : {}),
          ...(prior.id !== undefined ? { id: prior.id } : {}),
          ...(prior.deletePath ? { deletePath: prior.deletePath } : {}),
        };
        return;
      }
      // Only retry transient 404 (eventual-consistency window).
      if (resp.status !== 404) break;
    } catch (err) {
      lastNetErr = err instanceof Error ? err.message : String(err);
      // Network errors are not retried — they're not transient in the
      // eventual-consistency sense (they're config/connectivity issues).
      break;
    }
  }

  if (lastNetErr) {
    accumulateCleanupError(verdict, `DELETE ${delEp.path} network error: ${lastNetErr}`);
  } else if (lastResp) {
    const tail = lastResp.status === 404 ? " (persisted across retries — likely real leak)" : "";
    accumulateCleanupError(verdict, `DELETE ${delEp.path} → ${lastResp.status} (id=${id})${tail}`);
  }
}

function accumulateCleanupError(verdict: SecurityVerdict, msg: string): void {
  const prior = verdict.cleanup ?? { attempted: false };
  const errors = prior.error ? `${prior.error} | ${msg}` : msg;
  verdict.cleanup = {
    attempted: true,
    ...(prior.status ? { status: prior.status } : {}),
    ...(prior.id !== undefined ? { id: prior.id } : {}),
    ...(prior.deletePath ? { deletePath: prior.deletePath } : {}),
    error: errors,
  };
}

function pickId(body: unknown, field: string): string | number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;
  for (const key of [field, "id", "slug", "uuid", "key"]) {
    const v = obj[key];
    if (typeof v === "string" || typeof v === "number") return v;
  }
  return undefined;
}
