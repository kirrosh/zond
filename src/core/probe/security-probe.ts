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

  // ── Baseline-OK gate ────────────────────────────────────────────────────
  // The whole reason this command exists is to avoid the "5 × 404" output
  // the markdown template produced in the audit. If baseline isn't 2xx,
  // attacks would just hit the same 4xx and tell us nothing.
  let baselineResp;
  try {
    baselineResp = await executeRequest(
      { method: m, url, headers, body: JSON.stringify(baseline) },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
  } catch (err) {
    verdict.severity = "high";
    verdict.summary = `baseline network error: ${err instanceof Error ? err.message : String(err)}`;
    return verdict;
  }
  verdict.baseline = { status: baselineResp.status };
  const baselineOk = baselineResp.status >= 200 && baselineResp.status < 300;
  if (!baselineOk) {
    verdict.severity = "inconclusive-baseline";
    verdict.summary = `baseline ${baselineResp.status} — endpoint unreachable or fixture invalid; skipping attacks`;
    return verdict;
  }

  // If baseline created a stateful resource, cleanup before each attack so
  // we don't pile up uniqueness violations and don't leak rows. This also
  // matches what the manual YAML templates did via `always: true` cleanup.
  if (!opts.noCleanup) {
    await tryCleanup(ep, allEndpoints, schemes, vars, baselineResp.body_parsed ?? baselineResp.body, verdict, opts);
  }

  // ── Attacks ──────────────────────────────────────────────────────────────
  for (const hit of detected) {
    for (const payload of PAYLOADS[hit.class]) {
      const body = { ...baseline, [hit.field]: payload };
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
      verdict.findings.push(finding);

      // Per-finding cleanup if attack happened to create a resource.
      if (resp.status >= 200 && resp.status < 300 && !opts.noCleanup) {
        await tryCleanup(ep, allEndpoints, schemes, vars, resp.body_parsed ?? resp.body, verdict, opts);
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
