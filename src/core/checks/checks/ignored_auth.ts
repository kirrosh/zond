/**
 * `ignored_auth` (m-15 ARV-3) — for every operation that declares a
 * security requirement, send 3 requests:
 *
 *   1. baseline   — full real-auth headers,
 *   2. no_auth    — drop every auth header,
 *   3. bogus_auth — replace each auth header value with a malformed-
 *                   shaped, plausibly-typed bogus.
 *
 * If (2) or (3) returns 2xx, the server is silently ignoring auth →
 * HIGH finding. Anti-FP guards (mandatory):
 *   - skip operations with `security: []` override (explicitly public),
 *   - skip when baseline ≠ 2xx (auth setup is broken; we'd never see a
 *     valid 2xx, so a 4xx on (2)/(3) is meaningless),
 *   - skip when bootstrap_cleanup_failed (data state corrupted).
 */
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

function fillPath(path: string, params: { name: string; value: string }[]): string {
  return path.replace(/\{([^}]+)\}/g, (_, n) => {
    const p = params.find((x) => x.name === n);
    return p ? encodeURIComponent(p.value) : "1";
  });
}

function isAuthHeaderName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "authorization" || n.startsWith("x-api") || n.includes("token") || n.includes("key");
}

export const ignoredAuth: AuthStatefulCheck = {
  id: "ignored_auth",
  severity: "high",
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
    const url = `${h.baseUrl.replace(/\/+$/, "")}${fillPath(op.path, [])}`;
    const method = op.method.toUpperCase();
    const baseHeaders: Record<string, string> = { Accept: "application/json", ...h.authHeaders };

    // 1. baseline
    const baseReq: HttpRequest = { method, url, headers: baseHeaders };
    const baseline = await h.send(baseReq);
    if (baseline.status < 200 || baseline.status >= 300) {
      return { kind: "skip", reason: `baseline returned ${baseline.status} — broken-baseline guard` };
    }

    // 2. no_auth — strip every auth-shaped header
    const noAuthHeaders: Record<string, string> = { ...baseHeaders };
    for (const k of Object.keys(noAuthHeaders)) {
      if (isAuthHeaderName(k)) delete noAuthHeaders[k];
    }
    const noAuth = await h.send({ method, url, headers: noAuthHeaders });
    if (noAuth.status >= 200 && noAuth.status < 300) {
      return {
        kind: "fail",
        message: `Server accepted request without auth credentials (status ${noAuth.status}) — auth is being ignored`,
        evidence: { variant: "no_auth", baseline_status: baseline.status, no_auth_status: noAuth.status },
      };
    }

    // 3. bogus_auth — keep header names, replace values
    const bogusHeaders: Record<string, string> = { ...baseHeaders };
    for (const k of Object.keys(bogusHeaders)) {
      if (isAuthHeaderName(k)) bogusHeaders[k] = buildBogus(k, bogusHeaders[k]!);
    }
    const bogus = await h.send({ method, url, headers: bogusHeaders });
    if (bogus.status >= 200 && bogus.status < 300) {
      return {
        kind: "fail",
        message: `Server accepted request with bogus auth (status ${bogus.status}) — credentials not validated`,
        evidence: { variant: "bogus_auth", baseline_status: baseline.status, bogus_auth_status: bogus.status },
      };
    }

    return { kind: "pass" };
  },
};
