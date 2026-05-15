/**
 * `open_cors_on_sensitive` (ARV-256, m-21 pivot) — verify that an
 * authenticated endpoint does not echo arbitrary Origin values with
 * Access-Control-Allow-Credentials: true.
 *
 * The dangerous combo, in two shapes:
 *   - `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Credentials: true`
 *     (illegal per spec but seen in the wild; some servers patch out the
 *     star and emit just the credentials header — still broken)
 *   - `Access-Control-Allow-Origin: <reflected attacker Origin>` +
 *     `Access-Control-Allow-Credentials: true`
 *
 * Both let any cross-origin site read authenticated responses on behalf
 * of a logged-in user — classic CSRF-with-data-exfil surface.
 *
 * Sends one request with `Origin: https://evil.zond.test`, then
 * inspects the response CORS headers. Evidence_chain proof: request
 * Origin + response headers travel together in the finding.
 *
 * Anti-FP: skips endpoints with `security: []` override (intentionally
 * public). Skips when server doesn't emit any CORS headers (API isn't
 * configured for cross-origin — no problem to find).
 */
import type { AuthStatefulCheck } from "../stateful.ts";
import type { OpenAPIV3 } from "openapi-types";
import type { HttpRequest } from "../../runner/types.ts";

const PROBE_ORIGIN = "https://evil.zond.test";

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

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  return headers[name] ?? headers[name.toLowerCase()];
}

export const openCorsOnSensitive: AuthStatefulCheck = {
  id: "open_cors_on_sensitive",
  severity: "high",
  defaultExpected:
    "Authenticated endpoints must not echo arbitrary Origin with Allow-Credentials: true (cross-origin read of authed data)",
  references: [{ id: "OWASP-API-09-CORS" }],
  phase: "auth",
  applies(op) {
    // Same anti-FP as ignored_auth: skip explicit-public endpoints.
    if (op.security.length === 0) return false;
    return true;
  },
  async run(op, h) {
    const url = `${h.baseUrl.replace(/\/+$/, "")}${fillPath(op.path, op, h.pathVars)}`;
    const method = op.method.toUpperCase();
    // GET-only probe — bursting on POST/PATCH would create resources.
    // For mutating-only endpoints we still send the actual method with
    // the OPTIONS preflight-style Origin header, since most CORS
    // misconfigurations apply to non-preflight responses.
    const safeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS" ? method : "OPTIONS";
    const req: HttpRequest = {
      method: safeMethod,
      url,
      headers: {
        Accept: "application/json",
        ...h.authHeaders,
        Origin: PROBE_ORIGIN,
        // For non-GET probes, advertise the real method as the preflight
        // would.
        ...(safeMethod === "OPTIONS"
          ? {
              "Access-Control-Request-Method": method,
              "Access-Control-Request-Headers": "Authorization",
            }
          : {}),
      },
    };
    const resp = await h.send(req);

    const allowOrigin = getHeader(resp.headers, "access-control-allow-origin");
    const allowCreds = getHeader(resp.headers, "access-control-allow-credentials");

    // No CORS headers emitted → endpoint isn't configured for cross-origin.
    // Nothing to flag.
    if (!allowOrigin && !allowCreds) {
      return { kind: "skip", reason: "no CORS headers in response — API not configured for cross-origin" };
    }

    const credsTrue = (allowCreds ?? "").toLowerCase() === "true";
    const originIsStar = allowOrigin === "*";
    const originReflects = allowOrigin === PROBE_ORIGIN;

    // The smoking guns.
    if (credsTrue && originIsStar) {
      return {
        kind: "fail",
        message:
          "CORS misconfiguration: Allow-Origin: * with Allow-Credentials: true allows cross-origin reads of authenticated data",
        evidence: {
          request_origin: PROBE_ORIGIN,
          access_control_allow_origin: allowOrigin,
          access_control_allow_credentials: allowCreds,
          variant: "wildcard+credentials",
        },
      };
    }
    if (credsTrue && originReflects) {
      return {
        kind: "fail",
        message:
          "CORS misconfiguration: response reflects arbitrary Origin with Allow-Credentials: true — any attacker site can read authed responses",
        evidence: {
          request_origin: PROBE_ORIGIN,
          access_control_allow_origin: allowOrigin,
          access_control_allow_credentials: allowCreds,
          variant: "reflected+credentials",
        },
      };
    }
    return { kind: "pass" };
  },
};
