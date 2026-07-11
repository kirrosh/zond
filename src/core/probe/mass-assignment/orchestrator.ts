/**
 * Mass-assignment probe (T58) orchestrator.
 *
 * For each POST endpoint we craft a JSON body augmented with "suspected" extra
 * fields (is_admin, role, account_id, …) plus server-assigned fields lifted
 * from the response schema (id, created_at, …). We send the request live,
 * read the response, and — when the API returned 2xx — issue a follow-up GET
 * to differentiate two outcomes:
 *
 *   • accepted-and-applied — the suspicious value persisted ⇒ privilege
 *     escalation candidate (HIGH severity).
 *   • accepted-and-ignored — the suspicious value was silently dropped
 *     (LOW severity, soft-warn).
 *
 * Rejected (4xx) is the desired behaviour. 5xx is a separate bug class
 * (negative-probe territory).
 *
 * Auth is loaded from a `.env.yaml`-style file — same surface as `zond run`
 * uses via `loadEnvironment`. `base_url`, `auth_token`, `api_key` and any
 * path-param placeholders supplied in env are substituted into URLs.
 *
 * Optionally emits a YAML regression suite (`--emit-tests`) that locks in
 * the observed safe behaviour (rejected / ignored) so CI catches drift.
 */
import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import { executeRequest } from "../../runner/http-client.ts";
import {
  captureFieldFor,
  classifyPostSemantics,
  findDeleteCounterpart,
  findGetByIdCounterpart,
  liveAuthHeaders,
} from "../shared.ts";
import {
  buildBaselineFromSpec,
  buildBodyAuthHeaders,
  buildProbeUrl,
  hasProbeBody,
  serializeProbeBody,
} from "../probe-harness.ts";
import {
  createDiscoveryCache,
  discoverBodyFkVars,
  discoverPathParams,
  type DiscoveryCache,
} from "../path-discovery.ts";
import {
  isStrictContract,
  serverAssignedExtras,
  suspectedExtras,
} from "./suspects.ts";
import {
  classifyFromBody,
  finaliseSeverity,
  findIdParam,
  inconclusiveBaselineSummary,
  needsFollowUp,
  stampRecommendedAction,
} from "./classify.ts";
import { tryCleanupBaseline } from "./cleanup.ts";
import type {
  EndpointVerdict,
  MassAssignmentOptions,
  MassAssignmentResult,
  ProbeEndpointOpts,
} from "./types.ts";

export async function runMassAssignmentProbes(
  opts: MassAssignmentOptions,
): Promise<MassAssignmentResult> {
  const { endpoints, securitySchemes, vars, noCleanup, timeoutMs } = opts;
  const discover = opts.discover !== false;
  const cache: DiscoveryCache = createDiscoveryCache();
  const verdicts: EndpointVerdict[] = [];
  const warnings: string[] = [];
  let totalEndpoints = 0;

  for (const ep of endpoints) {
    if (ep.deprecated) continue;
    const m = ep.method.toUpperCase();
    if (m !== "POST" && m !== "PATCH" && m !== "PUT") continue;
    totalEndpoints++;

    // ARV-150: accept form-urlencoded endpoints in addition to JSON. Stripe
    // v1 declares only application/x-www-form-urlencoded for every mutating
    // operation — 265 endpoints were SKIPPED before this loosening.
    if (!hasProbeBody(ep)) {
      verdicts.push(skipped(ep, "no JSON or form-urlencoded request body"));
      continue;
    }

    // Resolve path placeholders, attempting auto-discovery when env doesn't
    // supply them and the spec has a sibling list endpoint (TASK-92).
    let effectiveVars = vars;
    const probe = buildProbeUrl(ep, vars);
    if (probe.unresolved.length > 0) {
      if (!discover) {
        const reason =
          m === "POST"
            ? `cannot resolve path placeholders: ${probe.unresolved.join(", ")} (set them in --env file)`
            : `${m} requires existing resource id; missing env vars: ${probe.unresolved.join(", ")}`;
        verdicts.push(skipped(ep, reason));
        continue;
      }
      const discovered = await discoverPathParams({
        ep,
        unresolved: probe.unresolved,
        allEndpoints: endpoints,
        schemes: securitySchemes,
        vars,
        cache,
        timeoutMs,
      });
      if (discovered.kind === "miss") {
        verdicts.push(
          skipped(
            ep,
            `cannot resolve path placeholders: ${probe.unresolved.join(", ")} — auto-discover failed (${discovered.reason})`,
          ),
        );
        continue;
      }
      effectiveVars = { ...vars, ...discovered.values };
    }

    // TASK-137: body-FK discovery. Required body fields named `audience_id`,
    // `project_slug`, `team_uuid`… get filled from sibling collection
    // endpoints. Without this, baseline POST hits 4xx because the random
    // string we'd otherwise send fails FK validation, and the verdict
    // becomes INCONCLUSIVE-baseline — a noise class that buried 51 verdicts
    // in the dogfooding audit (m-8 feedback §B).
    const bodyFkMisses: Array<{ field: string; reason: string }> = [];
    if (discover) {
      const bodyDiscovery = await discoverBodyFkVars({
        ep,
        allEndpoints: endpoints,
        schemes: securitySchemes,
        vars: effectiveVars,
        cache,
        timeoutMs,
      });
      if (Object.keys(bodyDiscovery.values).length > 0) {
        effectiveVars = { ...effectiveVars, ...bodyDiscovery.values };
      }
      bodyFkMisses.push(...bodyDiscovery.misses);
    }

    // Body-FK overlays. discoverBodyFkVars wrote into effectiveVars but the
    // baseline body is generated from spec via fake UUIDs / random strings —
    // substituteDeep only handles literal `{{var}}` markers, not field-name
    // matches. So we pass the resolved field→value map separately and the
    // probe overlays it onto baseline directly.
    let bodyFkOverlay: Record<string, string> | undefined;
    if (discover) {
      bodyFkOverlay = {};
      for (const k of Object.keys(effectiveVars)) {
        if (vars[k] === undefined && k.includes("_") && /(_id|_slug|_uuid|_key)$/.test(k)) {
          bodyFkOverlay[k] = effectiveVars[k]!;
        }
      }
      if (Object.keys(bodyFkOverlay).length === 0) bodyFkOverlay = undefined;
    }

    const verdict = await probeEndpoint(ep, endpoints, securitySchemes, effectiveVars, {
      noCleanup: noCleanup === true,
      timeoutMs,
      bodyFkMisses,
      bodyFkOverlay,
      extraSuspectFields: opts.extraSuspectFields,
      seedBody: opts.seedBodies?.get(`${ep.method.toUpperCase()} ${ep.path}`),
    });
    stampRecommendedAction(verdict);
    verdicts.push(verdict);
  }

  return {
    specProbed: verdicts.length,
    totalEndpoints,
    verdicts,
    warnings,
  };
}

function skipped(ep: EndpointInfo, reason: string): EndpointVerdict {
  return {
    method: ep.method.toUpperCase(),
    path: ep.path,
    severity: "skipped",
    summary: reason,
    request: { url: "", body: undefined, injectedFields: [] },
    fields: [],
    strictContract: isStrictContract(ep.requestBodySchema),
    skipReason: reason,
  };
}

async function probeEndpoint(
  ep: EndpointInfo,
  allEndpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  opts: ProbeEndpointOpts,
): Promise<EndpointVerdict> {
  const m = ep.method.toUpperCase();
  const strict = isStrictContract(ep.requestBodySchema);

  // Build baseline payload from spec then substitute generators ({{$uuid}}, …).
  const baseline = buildBaselineFromSpec(ep, vars, opts.seedBody);
  if (baseline === null) {
    return skipped(ep, "request body not a JSON object");
  }
  // TASK-137: overlay discovered FK values directly by field name so the
  // baseline body actually carries the real audience_id / project_slug / …
  // instead of the random UUID generateFromSchema synthesised.
  if (opts.bodyFkOverlay) {
    for (const [k, v] of Object.entries(opts.bodyFkOverlay)) {
      if (k in baseline) baseline[k] = v;
    }
  }

  const suspects = suspectedExtras(ep, opts.extraSuspectFields);
  const serverFields = serverAssignedExtras(ep);
  // Suspects win over server-assigned: if a field is both (e.g. `is_admin`
  // appears in the response schema AND is in our suspect list), the suspect
  // sentinel must be sent so we can detect privilege escalation.
  const injectedSet = { ...serverFields, ...suspects };
  const injectedNames = Object.keys(injectedSet);
  if (injectedNames.length === 0) {
    return skipped(ep, "no extra fields to inject (request schema covers everything)");
  }

  const body = { ...baseline, ...injectedSet };
  const { url, unresolved } = buildProbeUrl(ep, vars);
  if (unresolved.length > 0) {
    return skipped(
      ep,
      `cannot resolve path placeholders: ${unresolved.join(", ")} (set them in --env file)`,
    );
  }

  // ARV-150: Content-Type follows the spec — form-urlencoded for Stripe v1,
  // JSON otherwise. `serializeProbeBody` encodes the actual wire payload.
  const headers = buildBodyAuthHeaders(ep, schemes, vars);

  const verdict: EndpointVerdict = {
    method: m,
    path: ep.path,
    severity: "ok",
    summary: "",
    request: { url, body, injectedFields: injectedNames },
    fields: injectedNames.map(name => ({
      field: name,
      injected: injectedSet[name],
      outcome: "unknown",
    })),
    strictContract: strict,
  };

  // ── Baseline probe (TASK-91) ─────────────────────────────────────────────
  // Send the *clean* baseline body first. Without this, a 4xx caused by FK
  // miss / bad fixture / scope mismatch is indistinguishable from a 4xx that
  // actually rejected our extras — false-OK on FK-heavy SaaS APIs (Stripe /
  // Linear / GitHub-shaped). The baseline lets us classify:
  //   • baseline 4xx + injected 4xx → INCONCLUSIVE-baseline (fixture bug).
  //   • baseline 2xx + injected 4xx → OK (real extras rejection).
  //   • baseline 4xx + injected 2xx → HIGH (extras opened a code path the
  //     baseline never reached — privilege/auth bypass).
  //   • baseline 2xx + injected 2xx → existing applied/ignored flow.
  let baselineResp;
  try {
    baselineResp = await executeRequest(
      { method: m, url, headers, body: serializeProbeBody(ep, baseline).content },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
  } catch (err) {
    verdict.severity = "high";
    verdict.summary = `baseline network error: ${err instanceof Error ? err.message : String(err)}`;
    return verdict;
  }
  const baselineBody = baselineResp.body_parsed ?? baselineResp.body;
  verdict.baseline = { status: baselineResp.status, body: baselineBody };
  const baselineOk = baselineResp.status >= 200 && baselineResp.status < 300;
  // If baseline created a resource, DELETE it before issuing the injected
  // probe so the second POST doesn't trip a unique-constraint and so we
  // don't leak resources.
  if (baselineOk && !opts.noCleanup) {
    // ARV-429: record which id was deleted against which endpoint so a post-run
    // audit can distinguish a benign self-cleanup from a risky one.
    const cleanupAudit = await tryCleanupBaseline(ep, allEndpoints, schemes, vars, baselineBody, opts);
    if (cleanupAudit) verdict.cleanup = cleanupAudit;
  }

  // ── Injected probe ──────────────────────────────────────────────────────
  let resp;
  try {
    resp = await executeRequest(
      { method: m, url, headers, body: serializeProbeBody(ep, body).content },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
  } catch (err) {
    verdict.severity = "high";
    verdict.summary = `network error: ${err instanceof Error ? err.message : String(err)}`;
    return verdict;
  }
  verdict.response = { status: resp.status, body: resp.body_parsed ?? resp.body };

  if (resp.status >= 500) {
    // TASK-276: if the baseline (no extras) also crashed with ≥500, the
    // endpoint is just crashing — mass-assignment semantics aren't
    // observable, and validation-probe will already have flagged the same
    // endpoint. Don't surface as HIGH privilege-escalation; that buries
    // real findings under noise.
    if (baselineResp.status >= 500) {
      verdict.severity = "inconclusive-5xx";
      verdict.summary = `baseline ${baselineResp.status} → injected ${resp.status} — endpoint crashes regardless of extras (likely duplicate of validation-probe)`;
      for (const f of verdict.fields) f.outcome = "unknown";
      return verdict;
    }
    verdict.severity = "high";
    verdict.summary = `5xx unhandled (${resp.status}) — see negative-probe`;
    return verdict;
  }

  const injectedOk = resp.status >= 200 && resp.status < 300;

  // Matrix dispatch on baseline×injected (TASK-91):
  if (resp.status >= 400 && !injectedOk) {
    if (!baselineOk) {
      // Baseline body itself invalid — extras never reached validation.
      verdict.severity = "inconclusive-baseline";
      verdict.summary = inconclusiveBaselineSummary(
        baselineResp.status,
        baselineBody,
        opts.bodyFkMisses,
      );
      for (const f of verdict.fields) f.outcome = "unknown";
      return verdict;
    }
    // Baseline succeeded, injected rejected → real extras rejection.
    verdict.severity = "ok";
    verdict.summary = strict
      ? `rejected ${resp.status} — strict contract honoured`
      : `rejected ${resp.status} — extras refused (baseline ${baselineResp.status})`;
    for (const f of verdict.fields) f.outcome = "absent";
    return verdict;
  }

  if (injectedOk && !baselineOk) {
    // Extras-as-bypass: baseline didn't make it through, but adding extras did.
    // The extra fields opened a code path that baseline didn't reach (auth
    // scope, FK shadowing, etc.). Treat as HIGH — likely a real bug —
    // and continue to body-classification so per-field outcomes are still
    // recorded for the digest.
    verdict.severity = "high";
    const bypassReason =
      baselineResp.status >= 500
        ? "server crash on baseline — extras-bypass turned a 5xx into a successful write"
        : "extras opened a code path baseline didn't reach";
    verdict.summary = `extras-bypass: baseline ${baselineResp.status} → injected ${resp.status} (${bypassReason})`;
    // Fall through to the 2xx classification below; finaliseSeverity won't
    // overwrite "high" once it's set — but we also want to still mark
    // applied/ignored fields. We skip finaliseSeverity at the end for this
    // case to preserve the bypass summary.
  }

  // 2xx — analyse the response body for echoed values, then maybe GET.
  const respBody =
    typeof resp.body_parsed === "object" && resp.body_parsed !== null
      ? (resp.body_parsed as Record<string, unknown>)
      : undefined;

  classifyFromBody(verdict, respBody);

  // Follow-up GET if any field is still "absent" or "unknown" — to distinguish
  // ignored from silently-persisted-but-not-echoed.
  if (respBody && needsFollowUp(verdict)) {
    const idField = captureFieldFor(ep);
    const id = respBody[idField];
    const getEp = findGetByIdCounterpart(ep, allEndpoints);
    if (id !== undefined && getEp) {
      const getVars = { ...vars, [findIdParam(getEp)]: String(id), id: String(id) };
      const getUrl = buildProbeUrl(getEp, getVars);
      if (getUrl.unresolved.length === 0) {
        try {
          const getResp = await executeRequest(
            {
              method: "GET",
              url: getUrl.url,
              headers: {
                accept: "application/json",
                ...liveAuthHeaders(getEp, schemes, vars),
              },
            },
            { timeout: opts.timeoutMs ?? 30000, retries: 0 },
          );
          const getBody =
            typeof getResp.body_parsed === "object" && getResp.body_parsed !== null
              ? (getResp.body_parsed as Record<string, unknown>)
              : undefined;
          verdict.followUpGet = {
            url: getUrl.url,
            status: getResp.status,
            body: getResp.body_parsed ?? getResp.body,
          };
          if (getBody) classifyFromBody(verdict, getBody, true);
        } catch (err) {
          verdict.notes = [
            ...(verdict.notes ?? []),
            `follow-up GET failed: ${err instanceof Error ? err.message : String(err)}`,
          ];
        }
      }
    }

    // Cleanup
    if (!opts.noCleanup && id !== undefined) {
      const delEp = findDeleteCounterpart(ep, allEndpoints);
      if (delEp) {
        const delVars = { ...vars, [findIdParam(delEp)]: String(id), id: String(id) };
        const delUrl = buildProbeUrl(delEp, delVars);
        if (delUrl.unresolved.length === 0) {
          try {
            const delResp = await executeRequest(
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
            verdict.cleanup = { attempted: true, status: delResp.status };
          } catch (err) {
            verdict.cleanup = {
              attempted: true,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        } else {
          verdict.cleanup = { attempted: false, error: "unresolved DELETE path placeholders" };
        }
      } else {
        // ARV-153: action POSTs (`/capture`, `/verify`, `/cancel`, …) never
        // allocate a new resource — surface that instead of the alarming
        // "no DELETE counterpart" line that triggered F7's leak-risk noise.
        const reason =
          classifyPostSemantics(ep) === "action"
            ? "no cleanup needed (action endpoint — no resource created)"
            : "no DELETE counterpart in spec";
        verdict.cleanup = { attempted: false, error: reason };
      }
    }
  }

  // Preserve "high" already set by the extras-bypass branch; otherwise
  // derive severity from per-field outcomes.
  if (verdict.severity !== "high") finaliseSeverity(verdict, strict);
  stampRecommendedAction(verdict);
  return verdict;
}
