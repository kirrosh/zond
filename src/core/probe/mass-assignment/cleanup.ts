import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import { executeRequest } from "../../runner/http-client.ts";
import {
  captureFieldFor,
  findDeleteCounterpart,
  liveAuthHeaders,
} from "../shared.ts";
import { buildProbeUrl } from "../probe-harness.ts";
import { findIdParam } from "./classify.ts";

/**
 * Best-effort DELETE on the baseline (no-extras) probe so the injected
 * POST doesn't trip a unique-constraint and we don't leak resources.
 */
/** ARV-429: audit record of the cleanup DELETE this probe issued (or why it
 *  didn't). `undefined` when there was nothing to clean up (no self-created id
 *  or no DELETE counterpart) — no DELETE was sent. */
export type CleanupAudit =
  | { attempted: true; id: string; deletePath: string; status?: number; error?: string }
  | undefined;

export async function tryCleanupBaseline(
  ep: EndpointInfo,
  allEndpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  baselineBody: unknown,
  opts: { timeoutMs?: number },
): Promise<CleanupAudit> {
  const body =
    typeof baselineBody === "object" && baselineBody !== null
      ? (baselineBody as Record<string, unknown>)
      : undefined;
  if (!body) return undefined;
  const idField = captureFieldFor(ep);
  const id = body[idField];
  if (id === undefined) return undefined;
  const delEp = findDeleteCounterpart(ep, allEndpoints);
  if (!delEp) return undefined;
  const delVars = { ...vars, [findIdParam(delEp)]: String(id), id: String(id) };
  const delUrl = buildProbeUrl(delEp, delVars);
  if (delUrl.unresolved.length > 0) return undefined;
  const audit = { attempted: true as const, id: String(id), deletePath: `DELETE ${delEp.path}` };
  try {
    const resp = await executeRequest(
      {
        method: "DELETE",
        url: delUrl.url,
        headers: {
          accept: "application/json",
          ...liveAuthHeaders(delEp, schemes, vars),
        },
      },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
    return { ...audit, status: resp.status };
  } catch (err) {
    // best-effort — if cleanup fails we'll leak a baseline resource, but
    // that's a deployment problem, not a probe bug. Still record what we tried.
    return { ...audit, error: err instanceof Error ? err.message : String(err) };
  }
}
