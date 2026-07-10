import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import { executeRequest } from "../../runner/http-client.ts";
import {
  captureFieldFor,
  findDeleteCounterpart,
  liveAuthHeaders,
} from "../shared.ts";
import type { ProbeStepOpts, SecurityVerdict } from "./types.ts";
import { joinBaseAndPath } from "../../util/url.ts";

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
  const url = joinBaseAndPath(vars["base_url"], concretePath);
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

  const result = await replayDelete(url, headers, {
    timeoutMs: opts.timeoutMs,
    retryDelaysMs: opts.cleanupRetryDelaysMs,
  });
  if (result.ok) {
    const prior = verdict.cleanup ?? { attempted: false };
    verdict.cleanup = {
      attempted: true,
      status: result.status,
      ...(prior.error ? { error: prior.error } : {}),
      ...(prior.id !== undefined ? { id: prior.id } : {}),
      ...(prior.deletePath ? { deletePath: prior.deletePath } : {}),
    };
    return;
  }
  accumulateCleanupError(verdict, `DELETE ${delEp.path} ${result.error ?? "failed"} (id=${id})`);
}

/**
 * Verdict-free best-effort DELETE with eventual-consistency 404 retries.
 * POST creates on the write replica; an immediate DELETE can hit a read
 * replica that hasn't seen the new id yet → transient 404. Short backoffs
 * swallow that; a 404 that survives is a real leak. Only 404 is retried —
 * 5xx / network / 401 / 403 fail fast (the situation won't improve).
 * Shared by probe cleanup (tryCleanup) and checks coverage cleanup (ARV-415).
 */
export async function replayDelete(
  url: string,
  headers: Record<string, string>,
  opts: { timeoutMs?: number; retryDelaysMs?: number[] } = {},
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const RETRY_DELAYS_MS = opts.retryDelaysMs ?? [200, 1000];
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
      if (resp.status >= 200 && resp.status < 300) return { ok: true, status: resp.status };
      if (resp.status !== 404) break;
    } catch (err) {
      lastNetErr = err instanceof Error ? err.message : String(err);
      break;
    }
  }
  if (lastNetErr) return { ok: false, error: `network error: ${lastNetErr}` };
  if (lastResp) {
    const tail = lastResp.status === 404 ? " (persisted across retries — likely real leak)" : "";
    return { ok: false, status: lastResp.status, error: `→ ${lastResp.status}${tail}` };
  }
  return { ok: false, error: "no response" };
}

/**
 * ARV-415: best-effort cleanup of a resource just created by a 2xx POST in the
 * checks examples/coverage phase — parity with probe self-clean. POST ONLY: a
 * 2xx PUT/PATCH echoes a PRE-EXISTING fixture id we must never delete
 * (no-mutate-preexisting). Returns null when there's nothing safely deletable
 * (non-POST, no id in the response), or the DELETE outcome otherwise.
 */
export async function cleanupSelfCreatedResource(
  ep: EndpointInfo,
  allEndpoints: EndpointInfo[],
  opts: { baseUrl: string; headers: Record<string, string>; responseBody: unknown; timeoutMs?: number; retryDelaysMs?: number[] },
): Promise<{ ok: boolean; status?: number; error?: string } | null> {
  if (ep.method.toUpperCase() !== "POST") return null;
  const delEp = findDeleteCounterpart(ep, allEndpoints);
  if (!delEp) return { ok: false, error: `no DELETE counterpart for POST ${ep.path}; possible leaked resource` };
  const id = pickId(opts.responseBody, captureFieldFor(ep));
  if (id === undefined) return null; // no id in response → nothing self-created to delete
  const concretePath = delEp.path.replace(/\{[^}]+\}/, encodeURIComponent(String(id)));
  const url = joinBaseAndPath(opts.baseUrl, concretePath);
  return replayDelete(url, opts.headers, { timeoutMs: opts.timeoutMs, retryDelaysMs: opts.retryDelaysMs });
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
