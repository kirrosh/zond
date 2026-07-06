/**
 * `ignored_auth` (m-15 ARV-3, refined in ARV-181) — for every operation
 * that declares a security requirement, send 3 requests:
 *
 *   1. baseline   — full real-auth headers,
 *   2. no_auth    — drop every auth-shaped header,
 *   3. bogus_auth — replace each auth header value with a malformed-
 *                   shaped, plausibly-typed bogus.
 *
 * Verdict logic (ARV-181 differential):
 *
 *   - baseline 5xx → skip (server unhealthy; nothing we say is trustworthy).
 *   - baseline 2xx → strict mode. Any 2xx on no_auth/bogus → HIGH bypass.
 *   - baseline 4xx → soft mode. The auth token didn't get a 2xx (wrong
 *     permissions, real path-var not provided, etc.), but we can still
 *     learn from how the server treats *worse* credentials:
 *       · no_auth/bogus returns **strictly better** status (lower 4xx
 *         class, or 2xx/3xx) → HIGH bypass. The classic smoking gun
 *         is `baseline 403 / no_auth 200`.
 *       · same or worse status → pass (auth was checked; the resource
 *         simply isn't accessible to anyone).
 *
 * Strictness:
 *   - default: no_auth/bogus passes if status is in [400..499] (any 4xx).
 *   - --strict-401 (CheckRuntimeOptions.strict401): only 401 passes; any
 *     other status — even 403/404 — fails. Mirrors schemathesis V4.
 *
 * Anti-FP guards (kept from ARV-3):
 *   - skip operations with `security: []` override (explicitly public),
 *   - skip when `bootstrap_cleanup_failed` (data state corrupted),
 *   - skip when no auth headers provided to the harness at all.
 *
 * Severity matrix (ARV-286, dispatched per finding via outcome.severity;
 * follow-up to ARV-284 `negative_data_rejection` pattern):
 *
 *   Declared severity: 'low' (proof-cap baseline per ARV-250 — single-
 *   signal evidence alone caps at LOW; chain evidence elevates to HIGH).
 *
 *   Per-finding dispatch:
 *
 *   | evidence.variant          | severity | rationale                         |
 *   |---------------------------|----------|-----------------------------------|
 *   | no_auth                   | HIGH     | baseline 2xx + no-auth 2xx        |
 *   | bogus_auth                | HIGH     | baseline 2xx + bogus 2xx          |
 *   | no_auth_differential      | HIGH     | broken-baseline + lower bucket    |
 *   | bogus_auth_differential   | HIGH     | broken-baseline + lower bucket    |
 *   | no_auth_strict            | MEDIUM   | --strict-401 mismatch, no bypass  |
 *   | bogus_auth_strict         | MEDIUM   | --strict-401 mismatch, no bypass  |
 *
 *   HIGH variants (bypass + differential) provide chain evidence: both a
 *   baseline probe and an auth-stripped probe contribute — two independent
 *   signals proving auth is ignored. MEDIUM variants (strict-401
 *   conformance) are single-signal: auth is likely enforced (server still
 *   rejects), just with the wrong status code (403/404 instead of 401).
 *   The agent re-severitizes from the raw evidence.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { AuthStatefulCheck } from "../stateful.ts";
import type { HttpRequest } from "../../runner/types.ts";

function buildBogus(name: string, value: string): string {
  // Keep the original prefix so the auth scheme detection at the
  // server still matches (Bearer xxx, Basic xxx). Only the secret
  // payload is replaced.
  if (/^Bearer\s+/i.test(value)) return "Bearer aaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc";
  if (/^Basic\s+/i.test(value)) return "Basic " + Buffer.from("zzz:zzz").toString("base64");
  // apiKey / custom header — preserve length-class, replace content.
  return name.toLowerCase().includes("token") ? "ZZZZZZZZZZ" : "bogus-" + "z".repeat(8);
}

/** ARV-181: substitute path placeholders using `h.pathVars` first, then
 *  fall back to schema-derived placeholders. Mirrors `fillPathParams`
 *  in `runner.ts` (kept inline to avoid a cross-module dependency that
 *  would yank generator imports into stateful checks). */
function fillPath(
  path: string,
  op: { parameters: OpenAPIV3.ParameterObject[] },
  pathVars: Record<string, string> | undefined,
): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const real = pathVars?.[name];
    if (typeof real === "string" && real.length > 0) return encodeURIComponent(real);
    const param = op.parameters.find((p) => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
    if (schema?.type === "integer" || schema?.type === "number") return "1";
    return "x";
  });
}

function isAuthHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "authorization" || n.startsWith("x-api") || n.includes("token") || n.includes("key");
}

/** ARV-181: classify response status into a single ordering bucket so
 *  the differential broken-baseline logic can answer "did stripping
 *  auth give a *better* status than baseline?". Lower index = more
 *  permissive (worse from auth-enforcement POV). 5xx is its own
 *  bucket — never compare across it. */
function statusBucket(status: number): number {
  if (status >= 200 && status < 400) return 0; // accepted-ish
  if (status === 401) return 3;                // canonical "auth required"
  if (status === 403) return 2;                // permission denied
  if (status >= 400 && status < 500) return 1; // other 4xx (404, 422, ...)
  return -1;                                   // 5xx / 1xx — incomparable
}

function isAcceptableRejection(status: number, strict401: boolean): boolean {
  if (strict401) return status === 401;
  return status >= 400 && status < 500;
}

export const ignoredAuth: AuthStatefulCheck = {
  id: "ignored_auth",
  /** ARV-286: proof-cap baseline (ARV-250). Bypass findings emit
   *  outcome.severity="high" (chain evidence); strict-401 conformance
   *  findings emit outcome.severity="medium" (single-signal). */
  severity: "low",
  defaultExpected: "Server must reject requests without (or with bogus) auth credentials with 401/403",
  references: [{ id: "OWASP-API-01" }],
  phase: "auth",
  applies(op) {
    // Anti-FP: explicit `security: []` override means the op is intentionally public.
    if (op.security.length === 0) return false;
    return true;
  },
  async run(op, h) {
    if (h.bootstrapCleanupFailed) {
      return { kind: "skip", reason: "bootstrap-cleanup failed — security checks paused (ARV-3 AC #6)" };
    }
    if (Object.keys(h.authHeaders).length === 0) {
      return { kind: "skip", reason: "no auth headers provided to harness — pass --auth-header" };
    }
    const strict401 = h.options?.strict401 === true;
    const url = `${h.baseUrl.replace(/\/+$/, "")}${fillPath(op.path, op, h.pathVars)}`;
    const method = op.method.toUpperCase();
    const baseHeaders: Record<string, string> = { Accept: "application/json", ...h.authHeaders };

    // 1. baseline
    const baseReq: HttpRequest = { method, url, headers: baseHeaders };
    const baseline = await h.send(baseReq);
    if (baseline.status >= 500) {
      return { kind: "skip", reason: `baseline returned ${baseline.status} — server-side error, no trustworthy signal` };
    }

    // 2. no_auth — strip every auth-shaped header
    const noAuthHeaders: Record<string, string> = { ...baseHeaders };
    for (const k of Object.keys(noAuthHeaders)) {
      if (isAuthHeaderName(k)) delete noAuthHeaders[k];
    }
    const noAuth = await h.send({ method, url, headers: noAuthHeaders });

    // 3. bogus_auth — keep header names, replace values
    const bogusHeaders: Record<string, string> = { ...baseHeaders };
    for (const k of Object.keys(bogusHeaders)) {
      if (isAuthHeaderName(k)) bogusHeaders[k] = buildBogus(k, bogusHeaders[k]!);
    }
    const bogus = await h.send({ method, url, headers: bogusHeaders });

    const baseBucket = statusBucket(baseline.status);
    const baseIs2xx = baseline.status >= 200 && baseline.status < 300;

    // ── strict-2xx-baseline branch (legacy path, unchanged semantically) ──
    if (baseIs2xx) {
      if (noAuth.status >= 200 && noAuth.status < 300) {
        return {
          kind: "fail",
          // chain evidence: baseline 2xx + no-auth 2xx → proven bypass
          severity: "high",
          message: `Server accepted request without auth credentials (status ${noAuth.status}) — auth is being ignored`,
          evidence: { variant: "no_auth", baseline_status: baseline.status, no_auth_status: noAuth.status },
        };
      }
      if (bogus.status >= 200 && bogus.status < 300) {
        return {
          kind: "fail",
          // chain evidence: baseline 2xx + bogus-auth 2xx → credentials not validated
          severity: "high",
          message: `Server accepted request with bogus auth (status ${bogus.status}) — credentials not validated`,
          evidence: { variant: "bogus_auth", baseline_status: baseline.status, bogus_auth_status: bogus.status },
        };
      }
      if (strict401) {
        if (noAuth.status !== 401) {
          return {
            kind: "fail",
            // single-signal: auth is likely enforced (4xx returned), just wrong status code
            severity: "medium",
            message: `no_auth returned ${noAuth.status}, expected 401 (--strict-401)`,
            evidence: { variant: "no_auth_strict", baseline_status: baseline.status, no_auth_status: noAuth.status, strict_401: true },
          };
        }
        if (bogus.status !== 401) {
          return {
            kind: "fail",
            // single-signal: auth is likely enforced (4xx returned), just wrong status code
            severity: "medium",
            message: `bogus_auth returned ${bogus.status}, expected 401 (--strict-401)`,
            evidence: { variant: "bogus_auth_strict", baseline_status: baseline.status, bogus_auth_status: bogus.status, strict_401: true },
          };
        }
      }
      return { kind: "pass" };
    }

    // ── differential 4xx-baseline branch (ARV-181) ─────────────────────
    if (baseBucket < 0) {
      return { kind: "skip", reason: `baseline returned ${baseline.status} — incomparable status, no trustworthy signal` };
    }
    const noAuthBucket = statusBucket(noAuth.status);
    const bogusBucket = statusBucket(bogus.status);

    if (noAuthBucket >= 0 && noAuthBucket < baseBucket) {
      return {
        kind: "fail",
        // chain evidence: broken-baseline + lower bucket without auth → smoking gun bypass
        severity: "high",
        message: `Server gave a more permissive status (${noAuth.status}) without auth than with valid auth (${baseline.status}) — possible bypass`,
        evidence: { variant: "no_auth_differential", baseline_status: baseline.status, no_auth_status: noAuth.status },
      };
    }
    if (bogusBucket >= 0 && bogusBucket < baseBucket) {
      return {
        kind: "fail",
        // chain evidence: broken-baseline + lower bucket with bogus token → bypass
        severity: "high",
        message: `Server gave a more permissive status (${bogus.status}) with bogus auth than with valid auth (${baseline.status}) — possible bypass`,
        evidence: { variant: "bogus_auth_differential", baseline_status: baseline.status, bogus_auth_status: bogus.status },
      };
    }
    if (strict401) {
      if (!isAcceptableRejection(noAuth.status, true) && noAuthBucket >= 0) {
        return {
          kind: "fail",
          // single-signal: auth is enforced (server still rejects), wrong status code
          severity: "medium",
          message: `no_auth returned ${noAuth.status}, expected 401 (--strict-401, baseline ${baseline.status})`,
          evidence: { variant: "no_auth_strict", baseline_status: baseline.status, no_auth_status: noAuth.status, strict_401: true },
        };
      }
      if (!isAcceptableRejection(bogus.status, true) && bogusBucket >= 0) {
        return {
          kind: "fail",
          // single-signal: auth is enforced (server still rejects), wrong status code
          severity: "medium",
          message: `bogus_auth returned ${bogus.status}, expected 401 (--strict-401, baseline ${baseline.status})`,
          evidence: { variant: "bogus_auth_strict", baseline_status: baseline.status, bogus_auth_status: bogus.status, strict_401: true },
        };
      }
    }
    return { kind: "pass" };
  },
};
