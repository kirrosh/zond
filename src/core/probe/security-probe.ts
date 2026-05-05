/**
 * `zond probe-security <classes>` — live SSRF / CRLF / open-redirect probes.
 *
 * Mirrors the `probe-mass-assignment` shape: live runner, optional regression
 * YAML emission, idempotent cleanup. Where mass-assignment injects extra
 * suspect fields, this probe replaces a single benign field with a security
 * payload (SSRF / CRLF / open-redirect) and classifies the response.
 *
 * Why a CLI command rather than the markdown templates the audit skill
 * shipped with: the templates produced one HIGH (stored CRLF on Sentry) in
 * 5 minutes — but it was hand-copied per endpoint. Spec-driven autodetection
 * + a baseline-OK gate (TASK-138) turns that into a one-liner.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";
import type { RawSuite, RawStep } from "../generator/serializer.ts";
import { generateFromSchema } from "../generator/data-factory.ts";
import { substituteDeep, substituteString } from "../parser/variables.ts";
import { executeRequest } from "../runner/http-client.ts";
import {
  convertPath,
  endpointStem,
  findDeleteCounterpart,
  findGetByIdCounterpart,
  captureFieldFor,
  hasJsonBody,
  liveAuthHeaders,
} from "./shared.ts";

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
  cleanup?: { attempted: boolean; status?: number; error?: string };
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
}

export interface SecurityProbeResult {
  classes: SecurityClass[];
  totalEndpoints: number;
  specProbed: number;
  verdicts: SecurityVerdict[];
  warnings: string[];
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
}

export async function runSecurityProbes(
  opts: SecurityProbeOptions,
): Promise<SecurityProbeResult> {
  const verdicts: SecurityVerdict[] = [];
  const warnings: string[] = [];
  let totalEndpoints = 0;

  for (const ep of opts.endpoints) {
    if (ep.deprecated) continue;
    const m = ep.method.toUpperCase();
    if (m !== "POST" && m !== "PUT" && m !== "PATCH") continue;
    totalEndpoints++;

    if (!hasJsonBody(ep)) {
      verdicts.push(skipped(ep, "no JSON request body"));
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
      { noCleanup: opts.noCleanup === true, timeoutMs: opts.timeoutMs },
    );
    verdicts.push(verdict);
  }

  return {
    classes: opts.classes,
    totalEndpoints,
    specProbed: verdicts.length,
    verdicts,
    warnings,
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
  const rawBaseline = ep.requestBodySchema
    ? generateFromSchema(ep.requestBodySchema)
    : {};
  const baseline = substituteDeep(rawBaseline, vars) as Record<string, unknown>;
  if (typeof baseline !== "object" || baseline === null || Array.isArray(baseline)) {
    return skipped(ep, "request body not a JSON object");
  }

  const { url, unresolved } = buildUrl(ep, vars);
  if (unresolved.length > 0) {
    return skipped(ep, `cannot resolve path placeholders: ${unresolved.join(", ")}`);
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...liveAuthHeaders(ep, schemes, vars),
  };

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
  const fullBaseline = await sendBaseline(m, url, headers, baseline, opts);
  if (fullBaseline.kind === "network") {
    verdict.severity = "high";
    verdict.summary = `baseline network error: ${fullBaseline.reason}`;
    return verdict;
  }
  verdict.baseline = { status: fullBaseline.status };

  // ── Partial-body fallback (TASK-152) ──────────────────────────────────
  // Sentry / Stripe / GitHub-style APIs accept partial PUT — full bodies
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
      const partResp = await sendBaseline(m, url, headers, partial, opts);
      if (partResp.kind === "ok" && partResp.status >= 200 && partResp.status < 300) {
        perFieldBaseline.set(hit.field, partial);
      }
    }
    if (perFieldBaseline.size > 0 && snapshot) {
      // Each successful partial baseline mutated state — restore back so
      // attacks start from the snapshot.
      await restoreOriginal(ep, snapshot, headers, schemes, vars, opts, verdict);
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
  // With a snapshot → restore PUT. Without → DELETE-counterpart.
  if (fullOk && fullBaseline.kind === "ok" && !opts.noCleanup) {
    if (snapshot) {
      await restoreOriginal(ep, snapshot, headers, schemes, vars, opts, verdict);
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
          { method: m, url, headers, body: JSON.stringify(body) },
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
      // Annotate which body shape was used for this attack — useful for
      // case-studies and emit-tests.
      finding.reason = mode === "partial"
        ? `${finding.reason} [partial-body]`
        : finding.reason;
      verdict.findings.push(finding);

      // Per-finding cleanup. Snapshot path takes precedence — DELETE on a
      // PUT-rename'd resource would wipe a live entity, restore-PUT puts
      // it back to the captured original.
      if (resp.status >= 200 && resp.status < 300 && !opts.noCleanup) {
        if (snapshot) {
          await restoreOriginal(ep, snapshot, headers, schemes, vars, opts, verdict);
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
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: ProbeStepOpts,
): Promise<BaselineResult> {
  try {
    const resp = await executeRequest(
      { method, url, headers, body: JSON.stringify(body) },
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
  const { url, unresolved } = buildUrl(getEp, vars);
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

async function restoreOriginal(
  ep: EndpointInfo,
  snapshot: Snapshot,
  baseHeaders: Record<string, string>,
  _schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
  opts: ProbeStepOpts,
  verdict: SecurityVerdict,
): Promise<void> {
  const m = ep.method.toUpperCase();
  const { url, unresolved } = buildUrl(ep, vars);
  if (unresolved.length > 0) return;
  const headers: Record<string, string> = { ...baseHeaders };
  // Strip read-only / server-managed fields the GET response often echoes
  // (created_at, updated_at, id) — mirroring them back can confuse the
  // server with "you can't change this". Best-effort: drop common keys.
  const restoreBody: Record<string, unknown> = { ...snapshot.body };
  for (const k of ["id", "created_at", "createdAt", "updated_at", "updatedAt"]) {
    delete restoreBody[k];
  }
  if (snapshot.etag && ep.requiresEtag) {
    headers["If-Match"] = snapshot.etag;
  }
  let resp;
  try {
    resp = await executeRequest(
      { method: m, url, headers, body: JSON.stringify(restoreBody) },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
  } catch (err) {
    verdict.cleanup = {
      attempted: true,
      error: `restore network error: ${err instanceof Error ? err.message : String(err)}`,
    };
    return;
  }
  if (resp.status < 200 || resp.status >= 300) {
    verdict.cleanup = {
      attempted: true,
      status: resp.status,
      error: `restore failed: ${resp.status}`,
    };
    return;
  }
  verdict.cleanup = { attempted: true, status: resp.status };
}

function classify(
  hit: SecurityFieldHit,
  payload: string,
  resp: { status: number; body?: unknown; body_parsed?: unknown },
): SecurityFinding {
  const status = resp.status;
  const echoed = bodyContains(resp.body_parsed ?? resp.body, payload);

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
      return {
        field: hit.field,
        class: hit.class,
        payload,
        status,
        echoed,
        severity: "high",
        reason: `payload echoed in response — stored ${hit.class} candidate`,
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

function bodyContains(body: unknown, needle: string): boolean {
  if (!needle) return false;
  if (typeof body === "string") return body.includes(needle);
  try {
    return JSON.stringify(body).includes(needle);
  } catch {
    return false;
  }
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
  if (!delEp) return;
  const idField = captureFieldFor(ep);
  const id = pickId(responseBody, idField);
  if (!id) return;
  // DELETE path has one path-param at the end; replace it with the captured id.
  const concretePath = delEp.path.replace(/\{[^}]+\}/, encodeURIComponent(String(id)));
  const url = `${(vars["base_url"] ?? "").replace(/\/+$/, "")}${concretePath}`;
  const headers = liveAuthHeaders(delEp, schemes, vars);
  try {
    const resp = await executeRequest(
      { method: "DELETE", url, headers },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
    verdict.cleanup = { attempted: true, status: resp.status };
  } catch (err) {
    verdict.cleanup = {
      attempted: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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

// ──────────────────────────────────────────────
// URL building (mirrors mass-assignment-probe's `buildUrl`)
// ──────────────────────────────────────────────

function buildUrl(
  ep: EndpointInfo,
  vars: Record<string, string>,
): { url: string; unresolved: string[] } {
  const baseUrl = (vars["base_url"] ?? "").replace(/\/+$/, "");
  const templated = `${baseUrl}${convertPath(ep.path)}`;
  const substituted = String(substituteString(templated, vars));
  const unresolved = Array.from(substituted.matchAll(/\{\{([^}]+)\}\}/g)).map(
    m => m[1]!,
  );
  return { url: substituted, unresolved };
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
  lines.push("");

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
      lines.push(`- **${v.method} ${v.path}** — ${v.summary}`);
      for (const f of v.findings) {
        lines.push(`  - \`${f.field}\` / ${f.class} → ${f.status} (${f.severity}) — ${f.reason}`);
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
    const suiteHeaders = liveAuthHeadersTemplate(ep, schemes);
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

function liveAuthHeadersTemplate(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
): Record<string, string> | undefined {
  if (ep.security.length === 0) return undefined;
  for (const secName of ep.security) {
    const scheme = schemes.find(s => s.name === secName);
    if (!scheme) continue;
    if (scheme.type === "http" && (scheme.scheme === "bearer" || !scheme.scheme)) {
      return { Authorization: "Bearer {{auth_token}}" };
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      return scheme.apiKeyName === "Authorization"
        ? { Authorization: "Bearer {{auth_token}}" }
        : { [scheme.apiKeyName]: "{{api_key}}" };
    }
  }
  return undefined;
}
