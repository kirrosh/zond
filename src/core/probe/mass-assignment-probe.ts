/**
 * Mass-assignment probe (T58).
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
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";
import type { RawSuite, RawStep } from "../generator/serializer.ts";
import { generateFromSchema } from "../generator/data-factory.ts";
import { substituteDeep, substituteString } from "../parser/variables.ts";
import { executeRequest } from "../runner/http-client.ts";
import type { HttpRequest } from "../runner/types.ts";
import {
  convertPath,
  endpointStem,
  findDeleteCounterpart,
  findGetByIdCounterpart,
  captureFieldFor,
  hasJsonBody,
} from "./shared.ts";

// ──────────────────────────────────────────────
// Suspected fields (the "classic" mass-assignment vectors)
// ──────────────────────────────────────────────

/**
 * Sentinel values are deliberately distinctive so that — if they appear in a
 * follow-up GET response — we can be confident the server actually persisted
 * them rather than coincidentally generating the same value.
 */
export const SUSPECTED_FIELDS: Record<string, unknown> = {
  is_admin: true,
  is_system: true,
  verified: true,
  role: "admin",
  account_id: "00000000-0000-0000-0000-00000000beef",
  owner_id: "00000000-0000-0000-0000-00000000beef",
  user_id: "00000000-0000-0000-0000-00000000beef",
};

/** Sentinel values for server-assigned fields lifted from response schema. */
const SERVER_FIELD_SENTINEL = {
  uuid: "00000000-0000-0000-0000-00000000dead",
  isoDate: "2000-01-01T00:00:00.000Z",
  string: "zond-injected",
  integer: -424242,
  number: -424242,
  boolean: false,
};

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type Severity =
  | "high"
  | "medium"
  /** Baseline POST itself failed — we never reached extras-validation, so the
   *  4xx-with-extras was a false signal. User must fix fixture / FK / scope
   *  before this endpoint can be probed (TASK-91). */
  | "inconclusive-baseline"
  | "low"
  | "ok"
  | "skipped";

export interface FieldVerdict {
  field: string;
  injected: unknown;
  /** "applied" | "ignored" | "echoed-but-overwritten" | "absent" | "unknown" */
  outcome: "applied" | "ignored" | "echoed-overwritten" | "absent" | "unknown";
  /** Value as seen in the response body (or follow-up GET if applicable). */
  observed?: unknown;
}

export interface EndpointVerdict {
  method: string;
  path: string;
  severity: Severity;
  /** Canonical short reason (used in markdown header). */
  summary: string;
  request: {
    url: string;
    body: unknown;
    injectedFields: string[];
  };
  response?: {
    status: number;
    body?: unknown;
  };
  followUpGet?: {
    url: string;
    status: number;
    body?: unknown;
  };
  /** Result of the baseline (no-extras) probe — present whenever we sent it
   *  (always, except for skipped endpoints). Used to disambiguate
   *  «extras refused» from «baseline body invalid» (TASK-91). */
  baseline?: {
    status: number;
    body?: unknown;
  };
  fields: FieldVerdict[];
  /** True when request schema has additionalProperties:false (strict). */
  strictContract: boolean;
  cleanup?: {
    attempted: boolean;
    status?: number;
    error?: string;
  };
  /** Reason this endpoint was skipped (only set when severity === "skipped"). */
  skipReason?: string;
  notes?: string[];
}

export interface MassAssignmentOptions {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
  /** Substituted variables (base_url, auth_token, api_key, path params). */
  vars: Record<string, string>;
  /** When true, do not issue cleanup-DELETE after 2xx responses. */
  noCleanup?: boolean;
  /** Per-request fetch timeout (ms). */
  timeoutMs?: number;
}

export interface MassAssignmentResult {
  specProbed: number;
  totalEndpoints: number;
  verdicts: EndpointVerdict[];
  warnings: string[];
}

// ──────────────────────────────────────────────
// Schema helpers
// ──────────────────────────────────────────────

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function requestPropertyNames(schema?: OpenAPIV3.SchemaObject): Set<string> {
  const out = new Set<string>();
  if (!schema) return out;
  if (schema.properties) {
    for (const k of Object.keys(schema.properties)) out.add(k);
  }
  for (const composite of [schema.allOf, schema.oneOf, schema.anyOf]) {
    if (Array.isArray(composite)) {
      for (const sub of composite) {
        const s = sub as OpenAPIV3.SchemaObject;
        if (s.properties) for (const k of Object.keys(s.properties)) out.add(k);
      }
    }
  }
  return out;
}

function isStrictContract(schema?: OpenAPIV3.SchemaObject): boolean {
  if (!schema) return false;
  return schema.additionalProperties === false;
}

function pickServerFieldSentinel(s: OpenAPIV3.SchemaObject): unknown {
  if (s.format === "uuid") return SERVER_FIELD_SENTINEL.uuid;
  if (s.format === "date-time" || s.format === "date") return SERVER_FIELD_SENTINEL.isoDate;
  switch (s.type) {
    case "string": return SERVER_FIELD_SENTINEL.string;
    case "integer": return SERVER_FIELD_SENTINEL.integer;
    case "number": return SERVER_FIELD_SENTINEL.number;
    case "boolean": return SERVER_FIELD_SENTINEL.boolean;
    default: return SERVER_FIELD_SENTINEL.string;
  }
}

/** Server-assigned fields = response 2xx schema props that don't appear in request schema. */
function serverAssignedExtras(ep: EndpointInfo): Record<string, unknown> {
  const reqProps = requestPropertyNames(ep.requestBodySchema);
  const success = ep.responses.find(r => r.statusCode >= 200 && r.statusCode < 300 && r.schema);
  const respProps = success?.schema?.properties;
  const out: Record<string, unknown> = {};
  if (!respProps) return out;
  for (const [name, schema] of Object.entries(respProps)) {
    if (reqProps.has(name)) continue;
    out[name] = pickServerFieldSentinel(schema as OpenAPIV3.SchemaObject);
  }
  return out;
}

/** Extra fields that aren't legitimate request-body properties. */
function suspectedExtras(ep: EndpointInfo): Record<string, unknown> {
  const reqProps = requestPropertyNames(ep.requestBodySchema);
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(SUSPECTED_FIELDS)) {
    if (!reqProps.has(name)) out[name] = value;
  }
  return out;
}

// ──────────────────────────────────────────────
// URL building / auth
// ──────────────────────────────────────────────

function authHeadersLive(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
): Record<string, string> {
  if (ep.security.length === 0) return {};
  for (const secName of ep.security) {
    const scheme = schemes.find(s => s.name === secName);
    if (!scheme) continue;
    if (scheme.type === "http") {
      if (scheme.scheme === "bearer" || !scheme.scheme) {
        const tok = vars["auth_token"];
        if (tok) return { Authorization: `Bearer ${tok}` };
      }
      if (scheme.scheme === "basic") {
        const tok = vars["auth_token"];
        if (tok) return { Authorization: `Basic ${tok}` };
      }
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      if (scheme.apiKeyName === "Authorization") {
        const tok = vars["auth_token"];
        if (tok) return { Authorization: `Bearer ${tok}` };
      }
      const key = vars["api_key"];
      if (key) return { [scheme.apiKeyName]: key };
    }
  }
  return {};
}

function buildUrl(
  ep: EndpointInfo,
  vars: Record<string, string>,
): { url: string; unresolved: string[] } {
  const baseUrl = vars["base_url"]?.replace(/\/+$/, "") ?? "";
  const templated = `${baseUrl}${convertPath(ep.path)}`;
  const substituted = substituteString(templated, vars);
  const url = typeof substituted === "string" ? substituted : String(substituted);
  const unresolved = Array.from(url.matchAll(/\{\{([^}]+)\}\}/g)).map(m => m[1]!);
  return { url, unresolved };
}

// ──────────────────────────────────────────────
// Live probe execution
// ──────────────────────────────────────────────

export async function runMassAssignmentProbes(
  opts: MassAssignmentOptions,
): Promise<MassAssignmentResult> {
  const { endpoints, securitySchemes, vars, noCleanup, timeoutMs } = opts;
  const verdicts: EndpointVerdict[] = [];
  const warnings: string[] = [];
  let totalEndpoints = 0;

  for (const ep of endpoints) {
    if (ep.deprecated) continue;
    const m = ep.method.toUpperCase();
    if (m !== "POST" && m !== "PATCH" && m !== "PUT") continue;
    totalEndpoints++;

    if (!hasJsonBody(ep)) {
      verdicts.push(skipped(ep, "no JSON request body"));
      continue;
    }

    // PATCH/PUT typically need an existing resource id in the path. We can
    // probe them only when env supplies a value for every path placeholder.
    // POST is the primary surface; PATCH/PUT we skip with a note when the
    // path can't be resolved.
    if (m !== "POST") {
      const probe = buildUrl(ep, vars);
      if (probe.unresolved.length > 0) {
        verdicts.push(
          skipped(
            ep,
            `${m} requires existing resource id; missing env vars: ${probe.unresolved.join(", ")}`,
          ),
        );
        continue;
      }
    }

    const verdict = await probeEndpoint(ep, endpoints, securitySchemes, vars, {
      noCleanup: noCleanup === true,
      timeoutMs,
    });
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
  opts: { noCleanup: boolean; timeoutMs?: number },
): Promise<EndpointVerdict> {
  const m = ep.method.toUpperCase();
  const strict = isStrictContract(ep.requestBodySchema);

  // Build baseline payload from spec then substitute generators ({{$uuid}}, …).
  const rawBaseline = ep.requestBodySchema
    ? generateFromSchema(ep.requestBodySchema)
    : {};
  const baseline = substituteDeep(rawBaseline, vars) as Record<string, unknown>;
  if (typeof baseline !== "object" || baseline === null || Array.isArray(baseline)) {
    return skipped(ep, "request body not a JSON object");
  }

  const suspects = suspectedExtras(ep);
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
  const { url, unresolved } = buildUrl(ep, vars);
  if (unresolved.length > 0) {
    return skipped(
      ep,
      `cannot resolve path placeholders: ${unresolved.join(", ")} (set them in --env file)`,
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...authHeadersLive(ep, schemes, vars),
  };

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
      { method: m, url, headers, body: JSON.stringify(baseline) },
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
    await tryCleanupBaseline(ep, allEndpoints, schemes, vars, baselineBody, opts);
  }

  // ── Injected probe ──────────────────────────────────────────────────────
  let resp;
  try {
    resp = await executeRequest(
      { method: m, url, headers, body: JSON.stringify(body) },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
  } catch (err) {
    verdict.severity = "high";
    verdict.summary = `network error: ${err instanceof Error ? err.message : String(err)}`;
    return verdict;
  }
  verdict.response = { status: resp.status, body: resp.body_parsed ?? resp.body };

  if (resp.status >= 500) {
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
      verdict.summary = inconclusiveBaselineSummary(baselineResp.status, baselineBody);
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
    verdict.summary = `extras-bypass: baseline ${baselineResp.status} → injected ${resp.status} (extras opened a code path baseline didn't reach)`;
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
      const getUrl = buildUrl(getEp, getVars);
      if (getUrl.unresolved.length === 0) {
        try {
          const getResp = await executeRequest(
            {
              method: "GET",
              url: getUrl.url,
              headers: {
                accept: "application/json",
                ...authHeadersLive(getEp, schemes, vars),
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
        const delUrl = buildUrl(delEp, delVars);
        if (delUrl.unresolved.length === 0) {
          try {
            const delResp = await executeRequest(
              {
                method: "DELETE",
                url: delUrl.url,
                headers: {
                  accept: "application/json",
                  ...authHeadersLive(delEp, schemes, vars),
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
        verdict.cleanup = { attempted: false, error: "no DELETE counterpart in spec" };
      }
    }
  }

  // Preserve "high" already set by the extras-bypass branch; otherwise
  // derive severity from per-field outcomes.
  if (verdict.severity !== "high") finaliseSeverity(verdict, strict);
  return verdict;
}

async function tryCleanupBaseline(
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
  const delUrl = buildUrl(delEp, delVars);
  if (delUrl.unresolved.length > 0) return;
  try {
    await executeRequest(
      {
        method: "DELETE",
        url: delUrl.url,
        headers: {
          accept: "application/json",
          ...authHeadersLive(delEp, schemes, vars),
        },
      },
      { timeout: opts.timeoutMs ?? 30000, retries: 0 },
    );
  } catch {
    // best-effort — if cleanup fails we'll leak a baseline resource, but
    // that's a deployment problem, not a probe bug.
  }
}

/**
 * Build a one-line summary for INCONCLUSIVE-baseline verdicts. We surface
 * the server's error code/name when present so the user can immediately
 * see *which* FK / scope / fixture failed and fix it before re-probing.
 */
function inconclusiveBaselineSummary(status: number, body: unknown): string {
  const hint = extractBaselineHint(body);
  const base = `baseline body invalid — server returned ${status}`;
  const tail = " — fix fixture / FK value / path-params and re-probe";
  return hint ? `${base} (${hint})${tail}` : `${base}${tail}`;
}

function extractBaselineHint(body: unknown): string | undefined {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
  }
  if (typeof body !== "object" || body === null) return undefined;
  const obj = body as Record<string, unknown>;
  // Common error-envelope fields across SaaS APIs.
  const candidates = [
    obj.message,
    obj.error,
    (obj.error as Record<string, unknown> | undefined)?.message,
    obj.detail,
    obj.title,
    obj.name,
    obj.code,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) {
      return c.length > 120 ? `${c.slice(0, 120)}…` : c;
    }
  }
  return undefined;
}

function needsFollowUp(verdict: EndpointVerdict): boolean {
  return verdict.fields.some(f => f.outcome === "absent" || f.outcome === "unknown");
}

function classifyFromBody(
  verdict: EndpointVerdict,
  body: Record<string, unknown> | undefined,
  fromGet = false,
) {
  if (!body) return;
  for (const field of verdict.fields) {
    // Once a field is decisively classified (applied/echoed-overwritten),
    // don't downgrade. But "absent" on POST may still flip to applied/ignored
    // after GET — so only re-check those.
    if (field.outcome === "applied" || field.outcome === "echoed-overwritten") continue;
    if (!(field.field in body)) {
      // GET also missing → ignored. POST missing → keep "absent" so we GET later.
      field.outcome = fromGet ? "ignored" : "absent";
      continue;
    }
    const observed = body[field.field];
    field.observed = observed;
    if (deepEqual(observed, field.injected)) {
      field.outcome = "applied";
    } else if (fromGet) {
      field.outcome = "ignored";
    } else {
      field.outcome = "echoed-overwritten";
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function findIdParam(ep: EndpointInfo): string {
  const m = ep.path.match(/\{([^}]+)\}/);
  return m ? m[1]! : "id";
}

function finaliseSeverity(v: EndpointVerdict, strict: boolean) {
  const applied = v.fields.filter(f => f.outcome === "applied");
  const absent = v.fields.filter(f => f.outcome === "absent");

  if (applied.length > 0) {
    v.severity = "high";
    v.summary = `accepted-and-applied: ${applied.map(f => f.field).join(", ")}`;
    return;
  }
  if (absent.length > 0) {
    // Some fields couldn't be confirmed via response or follow-up GET — we
    // can't rule out silent persistence.
    v.severity = "medium";
    v.summary = `inconclusive — could not verify via follow-up GET (${absent.map(f => f.field).join(", ")})`;
    return;
  }
  v.severity = "low";
  const status = v.response?.status ?? 0;
  v.summary = `accepted ${status} but extras silently ignored${strict ? " (despite additionalProperties:false — server should reject)" : ""}`;
}

// ──────────────────────────────────────────────
// Markdown digest
// ──────────────────────────────────────────────

const SEVERITY_ORDER: Severity[] = [
  "high",
  "inconclusive-baseline",
  "medium",
  "low",
  "ok",
  "skipped",
];

const SEVERITY_HEADER: Record<Severity, string> = {
  high: "🚨 HIGH — privilege escalation candidates",
  "inconclusive-baseline": "⚠️  INCONCLUSIVE — baseline body invalid (fix fixture / FK / scope and re-probe)",
  medium: "⚠️  MEDIUM — inconclusive (no follow-up GET available)",
  low: "ℹ️  LOW — accepted-and-ignored (silent acceptance)",
  ok: "✅ OK — rejected 4xx (best behaviour)",
  skipped: "⏭️  SKIPPED",
};

export function formatDigestMarkdown(
  result: MassAssignmentResult,
  specPath: string,
): string {
  const lines: string[] = [];
  lines.push(`# Mass-assignment probe digest`);
  lines.push("");
  lines.push(`**Spec:** \`${specPath}\``);
  lines.push(`**Endpoints probed:** ${result.specProbed} of ${result.totalEndpoints} mutating endpoints`);
  lines.push("");
  lines.push(`**Suspected fields tested:** ${Object.keys(SUSPECTED_FIELDS).join(", ")}`);
  lines.push("");

  const buckets = groupBySeverity(result.verdicts);
  for (const sev of SEVERITY_ORDER) {
    const items = buckets[sev];
    if (!items || items.length === 0) continue;
    lines.push(`## ${SEVERITY_HEADER[sev]} (${items.length})`);
    lines.push("");
    for (const v of items) {
      lines.push(`### ${v.method} ${v.path}`);
      lines.push("");
      if (v.severity === "skipped") {
        lines.push(`- Skipped: ${v.skipReason ?? v.summary}`);
        lines.push("");
        continue;
      }
      lines.push(`- ${v.summary}`);
      lines.push(`- Injected: ${v.request.injectedFields.map(n => `\`${n}\``).join(", ")}`);
      if (v.baseline) {
        lines.push(`- Baseline (no extras): ${v.baseline.status}`);
      }
      if (v.response) {
        lines.push(`- With extras: ${v.response.status}`);
      }
      if (v.followUpGet) {
        lines.push(`- Follow-up GET → ${v.followUpGet.status}`);
      }
      const interesting = v.fields.filter(f => f.outcome !== "ignored" && f.outcome !== "absent");
      if (interesting.length > 0) {
        lines.push(`- Per-field outcomes:`);
        for (const f of interesting) {
          const obs = f.observed === undefined ? "n/a" : JSON.stringify(f.observed);
          lines.push(`  - \`${f.field}\` → **${f.outcome}** (injected ${JSON.stringify(f.injected)}, observed ${obs})`);
        }
      }
      if (v.cleanup) {
        if (v.cleanup.attempted) {
          lines.push(`- Cleanup DELETE: ${v.cleanup.status ?? "errored"}${v.cleanup.error ? ` — ${v.cleanup.error}` : ""}`);
        } else {
          lines.push(`- Cleanup skipped: ${v.cleanup.error ?? "unknown"}`);
        }
      }
      if (v.notes && v.notes.length > 0) {
        for (const n of v.notes) lines.push(`- Note: ${n}`);
      }
      if (v.severity === "high") {
        lines.push(`- **Action:** treat as P0 — server should reject or strip these fields.`);
      }
      if (v.severity === "inconclusive-baseline") {
        lines.push(
          `- **Action:** the baseline POST itself failed — set the right fixture / FK / path-params in your env (e.g. \`domain_id\`, \`account_id\`) and re-run.`,
        );
      }
      lines.push("");
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`## Warnings`);
    lines.push("");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  return lines.join("\n");
}

function groupBySeverity(verdicts: EndpointVerdict[]): Record<Severity, EndpointVerdict[]> {
  const out: Record<Severity, EndpointVerdict[]> = {
    high: [], "inconclusive-baseline": [], medium: [], low: [], ok: [], skipped: [],
  };
  for (const v of verdicts) out[v.severity].push(v);
  return out;
}

// ──────────────────────────────────────────────
// Regression-suite emitter (--emit-tests)
// ──────────────────────────────────────────────

const ACCEPTABLE_4XX = [400, 401, 403, 409, 415, 422];

/**
 * Emit YAML suites that lock in the safe behaviour observed during the live
 * run:
 *   • rejected (4xx) → assert status ∈ ACCEPTABLE_4XX (no regression to 2xx).
 *   • accepted-and-ignored → assert 2xx and that injected fields don't echo
 *     back. Follow-up GET — when available — additionally asserts the field
 *     is not persisted.
 *
 * "applied" / "inconclusive" are deliberately NOT emitted: those are bugs to
 * fix, not baselines to lock.
 */
export function emitRegressionSuites(
  result: MassAssignmentResult,
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
): RawSuite[] {
  const suites: RawSuite[] = [];
  for (const v of result.verdicts) {
    if (v.severity !== "ok" && v.severity !== "low") continue;
    const ep = endpoints.find(e => e.path === v.path && e.method.toUpperCase() === v.method);
    if (!ep) continue;
    const suiteHeaders = buildEmittedHeaders(ep, schemes);
    const probeStep: RawStep = {
      name: `mass-assignment: extras must ${v.severity === "ok" ? "be rejected" : "not apply"}`,
      [v.method]: convertPath(ep.path),
      json: v.request.body,
      expect: {
        status: v.severity === "ok" ? ACCEPTABLE_4XX : [200, 201, 202, 204],
      },
    };
    const tests: RawStep[] = [probeStep];
    // For ignored case + we have a follow-up GET → emit a verifying GET
    // that asserts injected fields are absent / overridden.
    if (v.severity === "low" && v.followUpGet) {
      const idField = captureFieldFor(ep);
      probeStep.expect.body = {
        ...(probeStep.expect.body ?? {}),
        [idField]: { capture: "created_id" },
      };
      const getEp = findGetByIdCounterpart(ep, endpoints);
      if (getEp) {
        const idParam = findIdParam(getEp);
        const getStep: RawStep = {
          name: `verify extras did not persist`,
          GET: convertPath(getEp.path).replace(`{{${idParam}}}`, "{{created_id}}"),
          expect: {
            status: 200,
            body: extrasNotEqualAssertions(v),
          },
        };
        tests.push(getStep);
      }
      // cleanup
      const delEp = findDeleteCounterpart(ep, endpoints);
      if (delEp) {
        const idParam = findIdParam(delEp);
        const delStep: RawStep = {
          name: "cleanup",
          always: true,
          DELETE: convertPath(delEp.path).replace(`{{${idParam}}}`, "{{created_id}}"),
          expect: { status: [200, 202, 204, 404] },
        } as RawStep & { always: boolean };
        tests.push(delStep);
      }
    }
    suites.push({
      name: `mass-assignment ${v.method} ${v.path}`,
      tags: ["probe-mass-assignment", v.severity === "ok" ? "rejected-baseline" : "ignored-baseline"],
      fileStem: `mass-assignment-${endpointStem(ep)}`,
      base_url: "{{base_url}}",
      ...(suiteHeaders ? { headers: suiteHeaders } : {}),
      tests,
    });
  }
  return suites;
}

function extrasNotEqualAssertions(v: EndpointVerdict): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const f of v.fields) {
    if (f.outcome === "ignored" || f.outcome === "echoed-overwritten" || f.outcome === "absent") {
      // Assert the suspicious value did NOT take effect. We check that the
      // observed value (from the live GET) still holds — the API is allowed
      // to echo a server default; what's forbidden is echoing OUR sentinel.
      const expectedNotEqual = JSON.stringify(f.injected);
      out[f.field] = { not_equals: expectedNotEqual };
    }
  }
  return out;
}

function buildEmittedHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
): Record<string, string> | undefined {
  if (ep.security.length === 0) return undefined;
  for (const secName of ep.security) {
    const scheme = schemes.find(s => s.name === secName);
    if (!scheme) continue;
    if (scheme.type === "http") {
      if (scheme.scheme === "bearer" || !scheme.scheme) {
        return { Authorization: "Bearer {{auth_token}}" };
      }
      if (scheme.scheme === "basic") {
        return { Authorization: "Basic {{auth_token}}" };
      }
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      if (scheme.apiKeyName === "Authorization") {
        return { Authorization: "Bearer {{auth_token}}" };
      }
      return { [scheme.apiKeyName]: "{{api_key}}" };
    }
  }
  return undefined;
}
