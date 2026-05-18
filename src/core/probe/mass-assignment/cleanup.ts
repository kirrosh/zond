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
export async function tryCleanupBaseline(
  ep: EndpointInfo,
  allEndpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  baselineBody: unknown,
  opts: { timeoutMs?: number },
): Promise<void> {
  const body =
    typeof baselineBody === "object" && baselineBody !== null
      ? (baselineBody as Record<string, unknown>)
      : undefined;
  if (!body) return;
  const idField = captureFieldFor(ep);
  const id = body[idField];
  if (id === undefined) return;
  const delEp = findDeleteCounterpart(ep, allEndpoints);
  if (!delEp) return;
  const delVars = { ...vars, [findIdParam(delEp)]: String(id), id: String(id) };
  const delUrl = buildProbeUrl(delEp, delVars);
  if (delUrl.unresolved.length > 0) return;
  try {
    await executeRequest(
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
  } catch {
    // best-effort — if cleanup fails we'll leak a baseline resource, but
    // that's a deployment problem, not a probe bug.
  }
}
