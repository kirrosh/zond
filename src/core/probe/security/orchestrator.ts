/**
 * `zond probe-security <classes>` — live SSRF / CRLF / open-redirect probes.
 *
 * Mirrors the `probe-mass-assignment` shape: live runner, optional regression
 * YAML emission, idempotent cleanup. Where mass-assignment injects extra
 * suspect fields, this probe replaces a single benign field with a security
 * payload (SSRF / CRLF / open-redirect) and classifies the response.
 */
import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import { executeRequest } from "../../runner/http-client.ts";
import {
  classifyPostSemantics,
  findDeleteCounterpart,
  pathTouchesSeededVar,
} from "../shared.ts";
import {
  buildBaselineFromSpec,
  buildBodyAuthHeaders,
  buildProbeUrl,
  hasProbeBody,
  serializeProbeBody,
} from "../probe-harness.ts";
import { applyAntiFp } from "../../anti-fp/index.ts";
import type { BaselineEchoCtx } from "../../anti-fp/rules/baseline-echo.ts";
import { detectFields, PAYLOADS } from "./detectors.ts";
import {
  restoreOriginal,
  sendBaseline,
  snapshotOriginal,
} from "./baseline.ts";
import { classify } from "./classify.ts";
import { tryCleanup } from "./cleanup.ts";
import type {
  CleanupFeasibility,
  ProbeStepOpts,
  SecurityFieldHit,
  SecurityProbeOptions,
  SecurityProbeResult,
  SecuritySeverity,
  SecurityVerdict,
} from "./types.ts";

export async function runSecurityProbes(
  opts: SecurityProbeOptions,
): Promise<SecurityProbeResult> {
  const verdicts: SecurityVerdict[] = [];
  const warnings: string[] = [];
  let totalEndpoints = 0;

  // ARV-140: pre-flight cleanup-feasibility scan. For each POST target, look
  // up the DELETE counterpart in the spec once. Without --allow-leaks any
  // attack against a POST-without-DELETE is dropped — orphan tracker can't
  // clean it (no DELETE path to retry) so it would linger in the user's
  // tenant indefinitely (feedback round-01/02 Sentry: 18 manual cleanups).
  const feasibility: CleanupFeasibility = {
    status: {},
    skippedNoCleanup: 0,
    forcedNoCleanup: 0,
    actionNoCleanupNeeded: 0,
  };
  for (const ep of opts.endpoints) {
    if (ep.deprecated) continue;
    if (ep.method.toUpperCase() !== "POST") continue;
    const key = `POST ${ep.path}`;
    // ARV-153: action POSTs (`/capture`, `/verify`, `/cancel`, …) don't
    // allocate a new resource — there is nothing to DELETE. Attacking them
    // without `--allow-leaks` is safe; classifying them up front prevents
    // the feasibility pre-flight from masking 18/22 Stripe action endpoints.
    const semantics = classifyPostSemantics(ep);
    if (semantics === "action") {
      feasibility.status[key] = "action";
      feasibility.actionNoCleanupNeeded += 1;
      continue;
    }
    const hasDelete = findDeleteCounterpart(ep, opts.endpoints) !== undefined;
    feasibility.status[key] = hasDelete ? "has-delete" : "no-delete-counterpart";
    if (!hasDelete) {
      if (opts.allowLeaks) feasibility.forcedNoCleanup += 1;
      else feasibility.skippedNoCleanup += 1;
    }
  }

  for (const ep of opts.endpoints) {
    if (ep.deprecated) continue;
    const m = ep.method.toUpperCase();
    if (m !== "POST" && m !== "PUT" && m !== "PATCH") continue;
    totalEndpoints++;

    // ARV-140: cleanup-feasibility gate. POST without a DELETE counterpart
    // (and without --allow-leaks) is dropped before any live request fires.
    // PUT/PATCH have snapshot/restore so they're unaffected here.
    if (m === "POST" && !opts.allowLeaks) {
      const status = feasibility.status[`POST ${ep.path}`];
      if (status === "no-delete-counterpart") {
        verdicts.push(skipped(ep, "skipped: no DELETE counterpart in spec (cleanup-feasibility pre-flight; pass --allow-leaks to override)"));
        continue;
      }
    }

    // TASK-264: --isolated guard. Mutation on a seeded fixture would corrupt
    // user data the next `zond run` depends on; skip the endpoint instead.
    if (opts.isolated && (m === "PUT" || m === "PATCH") && pathTouchesSeededVar(ep.path, opts.vars)) {
      verdicts.push(skipped(ep, "skipped: --isolated mode protects seeded fixtures (PUT/PATCH on seeded path-params)"));
      continue;
    }

    // ARV-161 (round-08 F18): parity with mass-assignment — accept
    // application/x-www-form-urlencoded endpoints too. Stripe v1 declares
    // user-controlled URL fields (webhook url, return_url, ...) only on
    // form-encoded bodies; the previous JSON-only gate hid 78+ POSTs from
    // SSRF/CRLF/open-redirect probing.
    if (!hasProbeBody(ep)) {
      verdicts.push(skipped(ep, "no JSON or form-urlencoded request body"));
      continue;
    }

    const detected = detectFields(ep, opts.classes);
    if (detected.length === 0) {
      verdicts.push(skipped(ep, `no fields matched classes: ${opts.classes.join(",")}`));
      continue;
    }

    if (opts.dryRun) {
      verdicts.push({
        method: m,
        path: ep.path,
        severity: "skipped",
        summary: "dry-run: would attack " + detected.map(d => `${d.field}/${d.class}`).join(", "),
        detectedFields: detected,
        findings: [],
        skipReason: "dry-run",
      });
      continue;
    }

    const verdict = await probeOneEndpoint(
      ep,
      opts.endpoints,
      opts.securitySchemes,
      opts.vars,
      detected,
      {
        noCleanup: opts.noCleanup === true,
        timeoutMs: opts.timeoutMs,
        cleanupRetryDelaysMs: opts.cleanupRetryDelaysMs,
        seedBody: opts.seedBodies?.get(`${ep.method.toUpperCase()} ${ep.path}`),
      },
    );
    verdicts.push(verdict);
  }

  return {
    classes: opts.classes,
    totalEndpoints,
    specProbed: verdicts.length,
    verdicts,
    warnings,
    cleanupFeasibility: feasibility,
  };
}

async function probeOneEndpoint(
  ep: EndpointInfo,
  allEndpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  detected: SecurityFieldHit[],
  opts: ProbeStepOpts,
): Promise<SecurityVerdict> {
  const m = ep.method.toUpperCase();
  const verdict: SecurityVerdict = {
    method: m,
    path: ep.path,
    severity: "ok",
    summary: "",
    detectedFields: detected,
    findings: [],
  };

  // Build baseline body. Same recipe as mass-assignment: spec → generators → vars.
  // ARV-269: agent-authored `seed_body` overlay wins when present.
  const baseline = buildBaselineFromSpec(ep, vars, opts.seedBody);
  if (baseline === null) {
    return skipped(ep, "request body not a JSON object");
  }

  const { url, unresolved } = buildProbeUrl(ep, vars);
  if (unresolved.length > 0) {
    return skipped(ep, `cannot resolve path placeholders: ${unresolved.join(", ")}`);
  }

  // ARV-161: Content-Type follows the spec — form-urlencoded for Stripe v1,
  // JSON otherwise. All outbound payloads in this function (baseline, per-
  // attack, restore-PUT) flow through serializeProbeBody for matching wire
  // encoding.
  const headers = buildBodyAuthHeaders(ep, schemes, vars);

  // ── Snapshot original state (TASK-151) ────────────────────────────────
  // For PUT/PATCH we MUST capture original state before any mutation. The
  // old DELETE-cleanup is wrong for rename'ы — it can't undo a renamed
  // DSN-key / team-name / webhook URL. Snapshot first, restore after each
  // 2xx. POST falls back to DELETE-cleanup (correct semantics there).
  const isUpdate = m === "PUT" || m === "PATCH";
  const snapshot = isUpdate && !opts.noCleanup
    ? await snapshotOriginal(ep, allEndpoints, schemes, vars, opts)
    : null;

  // ── Baseline-OK gate ────────────────────────────────────────────────────
  // Eliminates the "5 × 404" output the markdown template produced in the
  // audit. If baseline isn't 2xx, attacks would just hit the same 4xx
  // wall and tell us nothing.
  const fullBaseline = await sendBaseline(ep, m, url, headers, baseline, opts);
  if (fullBaseline.kind === "network") {
    verdict.severity = "high";
    verdict.summary = `baseline network error: ${fullBaseline.reason}`;
    return verdict;
  }
  verdict.baseline = { status: fullBaseline.status };

  // ── Partial-body fallback (TASK-152) ──────────────────────────────────
  // common SaaS-style APIs accept partial PUT — full bodies
  // generated from spec get rejected (422 / 400). Walking each detected
  // field with a single-key body recovers the proven-HIGH cases that
  // otherwise fall into INCONCLUSIVE-BASELINE.
  let fullOk = fullBaseline.kind === "ok" && fullBaseline.status >= 200 && fullBaseline.status < 300;
  const perFieldBaseline = new Map<string, Record<string, unknown>>();
  if (!fullOk && isUpdate && fullBaseline.kind === "ok") {
    for (const hit of detected) {
      // Reuse spec value when present; otherwise fall back to the substituted
      // generator output for the field. Either way the partial body has
      // exactly one key, which is what partial-PUT APIs accept.
      const partial: Record<string, unknown> = {};
      if (hit.field in baseline) partial[hit.field] = baseline[hit.field];
      else partial[hit.field] = "";
      const partResp = await sendBaseline(ep, m, url, headers, partial, opts);
      if (partResp.kind === "ok" && partResp.status >= 200 && partResp.status < 300) {
        perFieldBaseline.set(hit.field, partial);
      }
    }
    if (perFieldBaseline.size > 0 && snapshot) {
      // Each successful partial baseline mutated only its single key; restore
      // exactly those before attacks start.
      await restoreOriginal(
        ep, snapshot, headers, schemes, vars, opts, verdict,
        perFieldBaseline.keys(),
      );
    }
  }

  if (!fullOk && perFieldBaseline.size === 0) {
    // fullBaseline.kind === "network" was already returned above; here it
    // must be "ok" with non-2xx status.
    const status = fullBaseline.kind === "ok" ? fullBaseline.status : 0;
    verdict.severity = "inconclusive-baseline";
    verdict.summary = isUpdate
      ? `baseline ${status} on full body; partial-body per-field also rejected — fixture/scope issue`
      : `baseline ${status} — endpoint unreachable or fixture invalid; skipping attacks`;
    return verdict;
  }

  // Cleanup state mutated by the (full) baseline, before issuing attacks.
  // With a snapshot → restore PUT (full baseline mutated every key).
  // Without snapshot → DELETE-counterpart (POST flow).
  if (fullOk && fullBaseline.kind === "ok" && !opts.noCleanup) {
    if (snapshot) {
      await restoreOriginal(
        ep, snapshot, headers, schemes, vars, opts, verdict,
        Object.keys(baseline),
      );
    } else {
      await tryCleanup(
        ep, allEndpoints, schemes, vars,
        fullBaseline.body, verdict, opts,
      );
    }
  }

  // ── Attacks ──────────────────────────────────────────────────────────────
  for (const hit of detected) {
    // Pick the body shape that this endpoint actually accepts.
    let baseBody: Record<string, unknown> | undefined;
    let mode: "full" | "partial" | "none" = "none";
    if (fullOk) {
      baseBody = baseline;
      mode = "full";
    } else if (perFieldBaseline.has(hit.field)) {
      baseBody = perFieldBaseline.get(hit.field)!;
      mode = "partial";
    }

    if (mode === "none" || !baseBody) {
      // Field doesn't have a usable baseline body shape — record one
      // INCONCLUSIVE per payload so the digest still exposes the field.
      for (const payload of PAYLOADS[hit.class]) {
        verdict.findings.push({
          field: hit.field,
          class: hit.class,
          payload,
          status: 0,
          echoed: false,
          severity: "inconclusive",
          reason: "no baseline body shape accepted (full+partial both rejected)",
        });
      }
      continue;
    }

    for (const payload of PAYLOADS[hit.class]) {
      const body = { ...baseBody, [hit.field]: payload };
      let resp;
      try {
        resp = await executeRequest(
          { method: m, url, headers, body: serializeProbeBody(ep, body).content },
          { timeout: opts.timeoutMs ?? 30000, retries: 0 },
        );
      } catch (err) {
        verdict.findings.push({
          field: hit.field,
          class: hit.class,
          payload,
          status: 0,
          echoed: false,
          severity: "inconclusive",
          reason: `network error: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      const finding = classify(hit, payload, resp, { endpoint: ep });
      // ARV-126: route the 2xx-no-echo low-severity classification
      // through the anti-FP registry. When the response body deeply
      // equals the baseline body, the server ignored the attack
      // payload entirely — no side-effect to verify — and the
      // `baseline-echo` rule downgrades the finding to OK with a
      // wontfix banner. Only relevant for `mode === "full"` (we don't
      // retain per-field baseline response bodies).
      if (
        finding.severity === "low"
        && !finding.echoed
        && mode === "full"
        && fullBaseline.kind === "ok"
      ) {
        const ctx: BaselineEchoCtx = {
          responseBody: resp.body_parsed ?? resp.body,
          baselineBody: fullBaseline.body,
        };
        const suppression = applyAntiFp(ctx, "probe:security");
        if (suppression) {
          finding.severity = "ok";
          finding.reason = `${suppression.reason} (${suppression.ruleId})`;
        }
      }
      // Annotate which body shape was used for this attack — useful for
      // case-studies and emit-tests.
      finding.reason = mode === "partial"
        ? `${finding.reason} [partial-body]`
        : finding.reason;
      verdict.findings.push(finding);

      // Per-finding cleanup. Snapshot path takes precedence — DELETE on a
      // PUT-rename'd resource would wipe a live entity, restore-PUT puts
      // it back to the captured original. Only restore the single field
      // this attack mutated — sending a multi-key body trips
      // `422 use partial PUT` on common SaaS-shaped APIs.
      if (resp.status >= 200 && resp.status < 300 && !opts.noCleanup) {
        if (snapshot) {
          await restoreOriginal(
            ep, snapshot, headers, schemes, vars, opts, verdict,
            [hit.field],
          );
        } else {
          await tryCleanup(
            ep, allEndpoints, schemes, vars,
            resp.body_parsed ?? resp.body, verdict, opts,
          );
        }
      }
    }
  }

  // Roll up to the worst severity. ARV-253: "info" sits below "low"
  // (single_signal sanitization-only). ARV-254: "medium" sits between
  // "high" and "low" (SSRF accept on endpoint declaring delivery).
  const severities: SecuritySeverity[] = verdict.findings.map(f => f.severity);
  if (severities.includes("high")) verdict.severity = "high";
  else if (severities.includes("inconclusive")) verdict.severity = "inconclusive";
  else if (severities.includes("medium")) verdict.severity = "medium";
  else if (severities.includes("low")) verdict.severity = "low";
  else if (severities.includes("info")) verdict.severity = "info";
  else verdict.severity = "ok";

  verdict.summary = summaryLine(verdict);
  return verdict;
}

function summaryLine(v: SecurityVerdict): string {
  const counts: Record<SecuritySeverity, number> = {
    high: 0, medium: 0, low: 0, info: 0, inconclusive: 0, "inconclusive-baseline": 0, ok: 0, skipped: 0,
  };
  for (const f of v.findings) counts[f.severity]++;
  const fields = Array.from(new Set(v.detectedFields.map(d => d.field))).join(", ");
  return `fields=[${fields}] · HIGH=${counts.high} MED=${counts.medium} LOW=${counts.low} INFO=${counts.info} INCONCLUSIVE=${counts.inconclusive} OK=${counts.ok}`;
}

function skipped(ep: EndpointInfo, reason: string): SecurityVerdict {
  return {
    method: ep.method.toUpperCase(),
    path: ep.path,
    severity: "skipped",
    summary: `skipped: ${reason}`,
    detectedFields: [],
    findings: [],
    skipReason: reason,
  };
}
