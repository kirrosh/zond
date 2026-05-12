/**
 * `zond probe-security <classes>` — live SSRF / CRLF / open-redirect probes.
 *
 * Mirrors the `probe-mass-assignment` shape: live runner, optional regression
 * YAML emission, idempotent cleanup. Where mass-assignment injects extra
 * suspect fields, this probe replaces a single benign field with a security
 * payload (SSRF / CRLF / open-redirect) and classifies the response.
 *
 * Why a CLI command rather than the markdown templates the audit skill
 * shipped with: the templates produced one HIGH (stored CRLF in one real-world API) in
 * 5 minutes — but it was hand-copied per endpoint. Spec-driven autodetection
 * + a baseline-OK gate (TASK-138) turns that into a one-liner.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";
import type { RecommendedAction } from "../diagnostics/failure-hints.ts";
import { classify as classifyRecommendedAction } from "../classifier/recommended-action.ts";
import type { RawSuite, RawStep } from "../generator/serializer.ts";
import { generateFromSchema } from "../generator/data-factory.ts";
import { executeRequest } from "../runner/http-client.ts";
import {
  convertPath,
  endpointStem,
  findDeleteCounterpart,
  findGetByIdCounterpart,
  captureFieldFor,
  hasJsonBody,
  liveAuthHeaders,
  getAuthHeaders,
  pathTouchesSeededVar,
  classifyPostSemantics,
} from "./shared.ts";
import { hasProbeBody, buildBodyAuthHeaders, serializeProbeBody } from "./probe-harness.ts";
import {
  buildProbeUrl,
  buildJsonAuthHeaders,
  buildBaselineFromSpec,
} from "./probe-harness.ts";
import { applyAntiFp } from "../anti-fp/index.ts";
import type { BaselineEchoCtx } from "../anti-fp/rules/baseline-echo.ts";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type SecurityClass = "ssrf" | "crlf" | "open-redirect";

export const SECURITY_CLASSES: SecurityClass[] = ["ssrf", "crlf", "open-redirect"];

export type SecuritySeverity =
  | "high"
  | "low"
  | "inconclusive"
  | "inconclusive-baseline"
  | "ok"
  | "skipped";

export interface SecurityFieldHit {
  /** Field name in the request body. */
  field: string;
  /** Class that triggered (a field can hit multiple — we record all). */
  class: SecurityClass;
}

export interface SecurityFinding {
  field: string;
  class: SecurityClass;
  payload: string;
  /** Raw HTTP status of the attack request. */
  status: number;
  /** Whether the response body echoes the payload (suggesting stored injection). */
  echoed: boolean;
  /** PASS / FAIL classification per finding. */
  severity: SecuritySeverity;
  reason: string;
  /** TASK-294: agent-routable action. FAIL/WARN → `report_backend_bug`;
   *  PASS → undefined (no action needed). */
  recommended_action?: RecommendedAction;
}

export interface SecurityVerdict {
  method: string;
  path: string;
  /** Most-severe finding wins. */
  severity: SecuritySeverity;
  summary: string;
  /** Field hits detected on this endpoint (some may have produced no findings). */
  detectedFields: SecurityFieldHit[];
  /** All attempted attacks. Empty for SKIPPED endpoints. */
  findings: SecurityFinding[];
  baseline?: { status: number };
  cleanup?: {
    attempted: boolean;
    status?: number;
    error?: string;
    /** TASK-278: created resource id (slug/uuid/...) so `zond cleanup --orphans`
     *  can retry DELETE without re-running the probe. */
    id?: string | number;
    /** TASK-278: concrete DELETE URL path with the id substituted. */
    deletePath?: string;
  };
  skipReason?: string;
}

export interface SecurityProbeOptions {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
  vars: Record<string, string>;
  classes: SecurityClass[];
  noCleanup?: boolean;
  timeoutMs?: number;
  /** When true, only print which endpoints/fields would be attacked. */
  dryRun?: boolean;
  /**
   * DELETE-cleanup retry delays in ms (round-5: handles eventual
   * consistency between write replica and read replica). Default
   * `[200, 1000]` — two retries on 404, total worst-case ~1.2s. Tests
   * pass `[]` to disable; ops can pass longer for laggier replicas.
   */
  cleanupRetryDelaysMs?: number[];
  /** TASK-264: when true, refuse to attack PUT/PATCH/DELETE endpoints whose
   *  path-params are filled from `.env.yaml` (a.k.a. seeded fixtures). The
   *  trade-off: lower coverage (those endpoints get SKIPPED), but a
   *  guaranteed «probe doesn't mutate fixtures the user spent time
   *  bootstrapping» property. POST endpoints still run — they create their
   *  own resources, so isolation is automatic, with cleanup falling back to
   *  the existing DELETE-counterpart + orphan-tracker flow (TASK-278). */
  isolated?: boolean;
  /** ARV-140: opt-in to attacks that have no cleanup path (POSTs without a
   *  DELETE counterpart). By default we now skip them — round-01/02 Sentry
   *  runs left ~18 manually-cleanable orphans in prod because the probe
   *  happily POSTed to `/teams/`, `/symbol-sources/`, etc., where the spec
   *  has no DELETE. The pre-flight feasibility map drops these unless the
   *  caller explicitly accepts the leak. */
  allowLeaks?: boolean;
}

/** ARV-140: cleanup-feasibility map. Built once before the live loop so
 *  every POST verdict can see whether the spec has a DELETE counterpart;
 *  the summary digest also reports counts for skipped/forced endpoints.
 *
 *  ARV-153 extends the status enum with "action": POSTs whose last path
 *  segment is a known action verb (`/capture`, `/verify`, `/cancel`, …)
 *  operate on an existing resource and never allocate a new one, so a
 *  DELETE counterpart isn't meaningful. These are attacked the same way
 *  as POSTs with a real DELETE — without `--allow-leaks` — because there
 *  is no resource to leak. */
export interface CleanupFeasibility {
  status: Record<string, "has-delete" | "no-delete-counterpart" | "action">;
  skippedNoCleanup: number;
  forcedNoCleanup: number;
  /** ARV-153: POSTs we attacked even though no DELETE counterpart exists,
   *  because the operation is semantically an action (no resource created). */
  actionNoCleanupNeeded: number;
}

export interface SecurityProbeResult {
  classes: SecurityClass[];
  totalEndpoints: number;
  specProbed: number;
  verdicts: SecurityVerdict[];
  warnings: string[];
  /** ARV-140: cleanup-feasibility digest (POSTs without DELETE counterpart). */
  cleanupFeasibility?: CleanupFeasibility;
}

// ──────────────────────────────────────────────
// Field detectors
// ──────────────────────────────────────────────

const SSRF_NAME_RE =
  /(^url$|url$|webhook|callback|^redirect_uri$|^endpoint$|^uri$|^href$)/i;
const CRLF_NAME_RE =
  /(^subject$|prefix$|^name$|^title$|^description$|^tag$|^message_subject$)/i;
const OPEN_REDIRECT_NAME_RE =
  /(^redirect$|^next$|^return_to$|^redirect_url$|^redirect_to$|^redirectTo$)/i;

function matchesClass(
  cls: SecurityClass,
  name: string,
  schema: OpenAPIV3.SchemaObject,
): boolean {
  // Skip enum-bounded fields — payload would obviously fail validation
  // and we'd just waste requests on guaranteed-4xx attempts.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return false;
  if (schema.type !== "string" && schema.type !== undefined) return false;
  switch (cls) {
    case "ssrf":
      return SSRF_NAME_RE.test(name) || schema.format === "uri" || schema.format === "url";
    case "crlf":
      return CRLF_NAME_RE.test(name);
    case "open-redirect":
      return OPEN_REDIRECT_NAME_RE.test(name);
  }
}

export function detectFields(
  ep: EndpointInfo,
  classes: SecurityClass[],
): SecurityFieldHit[] {
  const out: SecurityFieldHit[] = [];
  const schema = ep.requestBodySchema;
  if (!schema || !schema.properties) return out;
  for (const [name, propSchema] of Object.entries(schema.properties)) {
    const s = propSchema as OpenAPIV3.SchemaObject;
    for (const cls of classes) {
      if (matchesClass(cls, name, s)) out.push({ field: name, class: cls });
    }
  }
  return out;
}

// ──────────────────────────────────────────────
// Payloads
// ──────────────────────────────────────────────

const PAYLOADS: Record<SecurityClass, string[]> = {
  ssrf: [
    "http://127.0.0.1:80/",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
  ],
  crlf: [
    "zond-safe\r\nX-Zond-Injected: yes",
    "zond-safe%0d%0aX-Zond-Injected: yes",
  ],
  "open-redirect": [
    "https://zond-attacker.example.tld",
    "//zond-attacker.example.tld",
  ],
};

// ──────────────────────────────────────────────
// Live probe runner
// ──────────────────────────────────────────────

interface ProbeStepOpts {
  noCleanup: boolean;
  timeoutMs?: number;
  cleanupRetryDelaysMs?: number[];
}

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

interface Snapshot {
  /** Original GET-response body, used to restore state via PUT/PATCH. */
  body: Record<string, unknown>;
  /** ETag (if API uses optimistic locking) — sent back as `If-Match` on restore. */
  etag?: string;
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
  const baseline = buildBaselineFromSpec(ep, vars);
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
  const fullBaseline = await sendBaseline(ep, m, url, headers,baseline, opts);
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
      const partResp = await sendBaseline(ep, m, url, headers,partial, opts);
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
      const finding = classify(hit, payload, resp);
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

  // Roll up to the worst severity.
  const severities: SecuritySeverity[] = verdict.findings.map(f => f.severity);
  if (severities.includes("high")) verdict.severity = "high";
  else if (severities.includes("inconclusive")) verdict.severity = "inconclusive";
  else if (severities.includes("low")) verdict.severity = "low";
  else verdict.severity = "ok";

  verdict.summary = summaryLine(verdict);
  return verdict;
}

// ──────────────────────────────────────────────
// Baseline send — wraps executeRequest with shape that distinguishes a real
// HTTP response from a network error (so the caller can decide whether to
// retry partial-body / mark the endpoint unreachable).
// ──────────────────────────────────────────────

type BaselineResult =
  | { kind: "ok"; status: number; body: unknown; headers: Record<string, string> }
  | { kind: "network"; reason: string };

async function sendBaseline(
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

// ──────────────────────────────────────────────
// TASK-151: snapshot + restore for stateful PUT/PATCH endpoints.
// ──────────────────────────────────────────────

async function snapshotOriginal(
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
async function restoreOriginal(
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

/** ARV-56: route through the single classifier. */
function stampAction(f: SecurityFinding): SecurityFinding {
  const action = classifyRecommendedAction({
    finding_class: "probe:security",
    severity: f.severity as Parameters<typeof classifyRecommendedAction>[0]["severity"],
  });
  if (action) f.recommended_action = action;
  return f;
}

function classify(
  hit: SecurityFieldHit,
  payload: string,
  resp: { status: number; body?: unknown; body_parsed?: unknown },
): SecurityFinding {
  return stampAction(classifyInner(hit, payload, resp));
}

function classifyInner(
  hit: SecurityFieldHit,
  payload: string,
  resp: { status: number; body?: unknown; body_parsed?: unknown },
): SecurityFinding {
  const status = resp.status;
  const echo = classifyEcho(resp.body_parsed ?? resp.body, payload, hit.class);
  const echoed = echo.matched;

  if (status >= 500) {
    return {
      field: hit.field,
      class: hit.class,
      payload,
      status,
      echoed,
      severity: "high",
      reason: `5xx unhandled — server crashed on ${hit.class} payload`,
    };
  }
  if (status >= 200 && status < 300) {
    if (echoed) {
      const label = echo.kind === "verbatim"
        ? "payload echoed verbatim"
        : `payload echoed (${echo.kind})`;
      return {
        field: hit.field,
        class: hit.class,
        payload,
        status,
        echoed,
        severity: "high",
        reason: `${label} — stored ${hit.class} candidate`,
      };
    }
    return {
      field: hit.field,
      class: hit.class,
      payload,
      status,
      echoed,
      severity: "low",
      reason: `2xx accepted ${hit.class} payload but no echo observed — verify side-effects manually`,
    };
  }
  if (status >= 400) {
    return {
      field: hit.field,
      class: hit.class,
      payload,
      status,
      echoed,
      severity: "ok",
      reason: `${status} rejected — ${hit.class} payload refused`,
    };
  }
  return {
    field: hit.field,
    class: hit.class,
    payload,
    status,
    echoed,
    severity: "inconclusive",
    reason: `unexpected status ${status}`,
  };
}

function bodyToString(body: unknown): string {
  if (!body) return "";
  if (typeof body === "string") return body;
  // Walk object/array, concatenating raw string leaves so CR/LF chars aren't
  // hidden behind JSON escape sequences (\r → "\\r" after JSON.stringify).
  const parts: string[] = [];
  const seen = new WeakSet<object>();
  const visit = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (v && typeof v === "object") {
      if (seen.has(v as object)) return;
      seen.add(v as object);
      if (Array.isArray(v)) v.forEach(visit);
      else for (const k of Object.keys(v as object)) visit((v as Record<string, unknown>)[k]);
    }
  };
  try {
    visit(body);
  } catch {
    return "";
  }
  return parts.join("\n");
}

function safeDecodeURI(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

type EchoKind =
  | "verbatim"
  | "url-decoded"
  | "CR stripped"
  | "LF stripped"
  | "CRLF→LF"
  | "CRLF→CR"
  | "tail after CRLF";

interface EchoResult {
  matched: boolean;
  kind: EchoKind | "none";
}

export function classifyEcho(body: unknown, payload: string, cls: SecurityClass): EchoResult {
  if (!payload) return { matched: false, kind: "none" };
  const haystackRaw = bodyToString(body);
  if (!haystackRaw) return { matched: false, kind: "none" };

  // SSRF / open-redirect: verbatim only — URLs are usually preserved as-is.
  if (cls !== "crlf") {
    return haystackRaw.includes(payload)
      ? { matched: true, kind: "verbatim" }
      : { matched: false, kind: "none" };
  }

  // CRLF: try verbatim → URL-decode pairs → CR/LF normalization variants → tail.
  if (haystackRaw.includes(payload)) return { matched: true, kind: "verbatim" };

  const haystackDecoded = safeDecodeURI(haystackRaw);
  const payloadDecoded = safeDecodeURI(payload);

  if (
    (payloadDecoded !== payload && haystackRaw.includes(payloadDecoded)) ||
    (haystackDecoded !== haystackRaw && haystackDecoded.includes(payload)) ||
    (payloadDecoded !== payload && haystackDecoded !== haystackRaw && haystackDecoded.includes(payloadDecoded))
  ) {
    return { matched: true, kind: "url-decoded" };
  }

  // Normalize: try variants of payload where backend stripped CR or LF.
  const variants: Array<[string, EchoKind]> = [];
  if (payloadDecoded.includes("\r\n")) {
    variants.push([payloadDecoded.replace(/\r\n/g, "\n"), "CRLF→LF"]);
    variants.push([payloadDecoded.replace(/\r\n/g, "\r"), "CRLF→CR"]);
    variants.push([payloadDecoded.replace(/\r\n/g, ""), "CRLF→LF"]);
  }
  if (payloadDecoded.includes("\r")) variants.push([payloadDecoded.replace(/\r/g, ""), "CR stripped"]);
  if (payloadDecoded.includes("\n")) variants.push([payloadDecoded.replace(/\n/g, ""), "LF stripped"]);

  for (const [variant, kind] of variants) {
    if (variant && variant !== payloadDecoded && (haystackRaw.includes(variant) || haystackDecoded.includes(variant))) {
      return { matched: true, kind };
    }
  }

  // Tail-substring: parser truncated at newline, only suffix landed in storage.
  const splitMatch = payloadDecoded.match(/(?:\r\n|%0d%0a|%0a|%0d|\r|\n)(.+)$/i);
  const tail = splitMatch?.[1];
  if (tail && tail.length >= 3 && (haystackRaw.includes(tail) || haystackDecoded.includes(tail))) {
    return { matched: true, kind: "tail after CRLF" };
  }

  return { matched: false, kind: "none" };
}

function summaryLine(v: SecurityVerdict): string {
  const counts: Record<SecuritySeverity, number> = {
    high: 0, low: 0, inconclusive: 0, "inconclusive-baseline": 0, ok: 0, skipped: 0,
  };
  for (const f of v.findings) counts[f.severity]++;
  const fields = Array.from(new Set(v.detectedFields.map(d => d.field))).join(", ");
  return `fields=[${fields}] · HIGH=${counts.high} LOW=${counts.low} INCONCLUSIVE=${counts.inconclusive} OK=${counts.ok}`;
}

// ──────────────────────────────────────────────
// Cleanup helper — best-effort DELETE on stateful endpoints.
// ──────────────────────────────────────────────

async function tryCleanup(
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

// ──────────────────────────────────────────────
// Markdown digest
// ──────────────────────────────────────────────

/** TASK-154 §N: clip noisy payloads (some SSRF/CRLF/redirect strings are URL-
 *  encoded blobs > 60 chars). Keep the leading prefix users recognise plus an
 *  ellipsis, so the digest line stays readable. */
function truncatePayload(payload: string, max: number): string {
  if (payload.length <= max) return payload;
  return payload.slice(0, max - 1) + "…";
}

export function formatSecurityDigest(
  result: SecurityProbeResult,
  specPath: string,
): string {
  const lines: string[] = [];
  lines.push(`# zond probe-security digest`);
  lines.push("");
  lines.push(`Spec: \`${specPath}\``);
  lines.push(`Classes: ${result.classes.join(", ")}`);
  lines.push(`Endpoints scanned: ${result.totalEndpoints} · probed: ${result.specProbed}`);
  // ARV-140 AC#4: surface the cleanup-feasibility outcome up front so a
  // green run doesn't hide "we attacked 14 leak-prone POSTs anyway".
  if (result.cleanupFeasibility) {
    const f = result.cleanupFeasibility;
    if (f.skippedNoCleanup > 0) {
      lines.push(`Cleanup pre-flight: ${f.skippedNoCleanup} endpoint(s) skipped (no DELETE counterpart). Pass \`--allow-leaks\` to attack anyway.`);
    } else if (f.forcedNoCleanup > 0) {
      lines.push(`Cleanup pre-flight: ${f.forcedNoCleanup} endpoint(s) attacked despite no DELETE counterpart (--allow-leaks).`);
    }
    // ARV-153: surface action-verb POSTs we now attack without a DELETE
    // counterpart so green runs make the recall win visible.
    if (f.actionNoCleanupNeeded > 0) {
      lines.push(`Cleanup pre-flight: ${f.actionNoCleanupNeeded} action POST(s) attacked (no resource created — DELETE counterpart not needed).`);
    }
  }
  lines.push("");

  // Cleanup failures section is mandatory and goes FIRST when present —
  // round-4 dogfooding: a "green" run (HIGH=0) silently leaked DSN keys
  // and left renamed projects, because cleanup failures were buried in
  // per-verdict objects. Surface them prominently so a green probe is a
  // signal the org is clean, not just that nothing crashed.
  const cleanupFailures = result.verdicts.filter(v => v.cleanup?.error);
  if (cleanupFailures.length > 0) {
    lines.push(`## ⚠️ Cleanup failures (${cleanupFailures.length}) — manual remediation may be required`);
    lines.push("");
    for (const v of cleanupFailures) {
      lines.push(`- **${v.method} ${v.path}** — ${v.cleanup!.error}`);
    }
    lines.push("");
  }

  const buckets: Record<SecuritySeverity, SecurityVerdict[]> = {
    high: [], low: [], inconclusive: [], "inconclusive-baseline": [], ok: [], skipped: [],
  };
  for (const v of result.verdicts) buckets[v.severity].push(v);

  const ordered: SecuritySeverity[] = ["high", "inconclusive", "inconclusive-baseline", "low", "ok", "skipped"];
  const titles: Record<SecuritySeverity, string> = {
    high: "🚨 HIGH — server crashed or echoed payload",
    low: "🟡 LOW — 2xx accepted but no echo (verify manually)",
    inconclusive: "❓ INCONCLUSIVE — could not classify",
    "inconclusive-baseline": "⚠️ INCONCLUSIVE-BASELINE — baseline 4xx, attacks not run",
    ok: "✅ OK — payloads rejected with 4xx",
    skipped: "⏭️ SKIPPED — no detected fields / no body",
  };
  for (const sev of ordered) {
    const list = buckets[sev];
    if (list.length === 0) continue;
    lines.push(`## ${titles[sev]} (${list.length})`);
    lines.push("");
    for (const v of list) {
      const cleanupTag = v.cleanup?.error ? " 🧹 cleanup-failure" : "";
      lines.push(`- **${v.method} ${v.path}**${cleanupTag} — ${v.summary}`);
      for (const f of v.findings) {
        // TASK-154 §N: surface the actual payload that triggered the finding
        // — without it the digest is useless for case-study writing (which
        // SSRF target? which CRLF shape?). Truncate long payloads so the
        // line stays readable.
        const payload = truncatePayload(f.payload, 60);
        lines.push(`  - \`${f.field}\` / ${f.class} [\`${payload}\`] → ${f.status} (${f.severity}) — ${f.reason}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ──────────────────────────────────────────────
// Regression suite emission
// ──────────────────────────────────────────────

const ATTACK_EXPECTED_STATUS = [400, 403, 404, 405, 409, 415, 422];

export function emitSecurityRegressionSuites(
  result: SecurityProbeResult,
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
): RawSuite[] {
  const suites: RawSuite[] = [];
  for (const v of result.verdicts) {
    if (v.severity !== "ok" && v.severity !== "low") continue;
    const ep = endpoints.find(
      e => e.path === v.path && e.method.toUpperCase() === v.method,
    );
    if (!ep) continue;
    const suiteHeaders = getAuthHeaders(ep, schemes);
    const tests: RawStep[] = [];
    for (const f of v.findings) {
      const expected = f.severity === "ok" ? ATTACK_EXPECTED_STATUS : [200, 201, 202, 204];
      const body = ep.requestBodySchema ? generateFromSchema(ep.requestBodySchema) : {};
      if (typeof body === "object" && body !== null && !Array.isArray(body)) {
        (body as Record<string, unknown>)[f.field] = f.payload;
      }
      const step: RawStep = {
        name: `${f.class}: ${f.field}=${shortPayload(f.payload)} must ${f.severity === "ok" ? "be rejected" : "not echo"}`,
        source: {
          generator: "probe-security",
          endpoint: `${v.method} ${v.path}`,
          response_branch: expected.map(String).join("|"),
        },
        [v.method]: convertPath(ep.path),
        json: body,
        expect: { status: expected },
      };
      tests.push(step);
    }
    if (tests.length === 0) continue;
    // Attach a generic cleanup step keyed off `created_id` (only fires when
    // a previous step captured one — same `always:true` semantics other
    // probes use).
    const delEp = findDeleteCounterpart(ep, endpoints);
    if (delEp) {
      const idField = captureFieldFor(ep);
      tests[0]!.expect.body = { ...(tests[0]!.expect.body ?? {}), [idField]: { capture: "created_id" } };
      const idParam = (delEp.path.match(/\{([^}]+)\}/) ?? [])[1] ?? "id";
      const delStep: RawStep = {
        name: "cleanup",
        source: { generator: "probe-security-cleanup", endpoint: `DELETE ${delEp.path}` },
        always: true,
        DELETE: convertPath(delEp.path).replace(`{{${idParam}}}`, "{{created_id}}"),
        expect: { status: [200, 202, 204, 404] },
      } as RawStep & { always: boolean };
      tests.push(delStep);
    }
    suites.push({
      name: `probe-security ${v.method} ${v.path}`,
      tags: ["probe-security", ...result.classes],
      source: {
        type: "probe-suite",
        generator: "probe-security",
        endpoint: `${v.method} ${v.path}`,
      },
      fileStem: `probe-security-${endpointStem(ep)}`,
      base_url: "{{base_url}}",
      ...(suiteHeaders ? { headers: suiteHeaders } : {}),
      tests,
    });
  }
  return suites;
}

function shortPayload(s: string): string {
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}

