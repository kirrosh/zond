/**
 * `rate_limit_headers_absent` (ARV-256, m-21 pivot) — flag mutating
 * endpoints (POST/PATCH/PUT/DELETE) whose 2xx responses ship no
 * rate-limit-* headers at all.
 *
 * The full version of this check would burst N requests to detect a
 * 429, but bursting POST creates real resources — too destructive for
 * a default-on check. The lightweight header-inspect version is what
 * Burp/ZAP also do at first pass: detect the absence of standard
 * rate-limit metadata in the response. If the server emits any of
 * `X-RateLimit-*` / `RateLimit-*` / `Retry-After`, this check skips —
 * the server has *some* rate-limit story.
 *
 * Reliability category (ARV-251): missing rate-limit on write
 * endpoints is a production concern (abuse → bill, abuse → DoS), not
 * a security exploit. Severity MEDIUM by default.
 *
 * Anti-FP: skip non-mutating methods. Skip non-2xx responses (a 4xx
 * doesn't tell us anything about rate-limit behaviour on the happy
 * path). Skip endpoints with `security: []` override (public read-only
 * APIs may intentionally omit rate-limit headers).
 */
import type { Check } from "../types.ts";

const RATE_LIMIT_PATTERNS: RegExp[] = [
  /^x-ratelimit-/i,
  /^x-rate-limit-/i,
  /^ratelimit-/i,
  /^retry-after$/i,
];

function hasRateLimitHeader(headers: Record<string, string>): boolean {
  for (const name of Object.keys(headers)) {
    for (const re of RATE_LIMIT_PATTERNS) {
      if (re.test(name)) return true;
    }
  }
  return false;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const rateLimitHeadersAbsent: Check = {
  id: "rate_limit_headers_absent",
  severity: "medium",
  defaultExpected:
    "Mutating endpoints should advertise rate-limit semantics via X-RateLimit-* / RateLimit-* / Retry-After headers",
  references: [
    { id: "RFC-9239-rate-limit-headers" },
    { id: "OWASP-API-04-rate-limit" },
  ],
  applies(op) {
    if (!MUTATING.has(op.method.toUpperCase())) return false;
    // Skip explicitly-public endpoints (security: [] override) — those
    // are often abuse-tolerant by design (anonymous feedback forms etc).
    if (op.security.length === 0) return false;
    return true;
  },
  run({ response }) {
    if (response.status < 200 || response.status >= 300) {
      return { kind: "skip", reason: `non-2xx response (${response.status}) — rate-limit semantics only meaningful on success` };
    }
    if (hasRateLimitHeader(response.headers)) {
      return { kind: "pass" };
    }
    return {
      kind: "fail",
      message:
        "Mutating endpoint returned 2xx without any rate-limit-* / Retry-After header — no advertised abuse protection on a write path",
      evidence: {
        method: "POST/PUT/PATCH/DELETE",
        response_status: response.status,
        looked_for: ["X-RateLimit-*", "RateLimit-*", "Retry-After"],
      },
    };
  },
};
