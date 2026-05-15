/**
 * Finding category taxonomy (ARV-251, m-21 pivot).
 *
 * Four categories replace the old SARIF-internal trio
 * (conformance/security/data-rejection/other). Each finding belongs to
 * exactly one category. Categories drive the per-section roll-up in
 * reports — a small team sees `0 security, 12 reliability, 40 contract,
 * 200 hygiene` and knows where to start, instead of one flat HIGH/LOW
 * pile.
 *
 * Definitions:
 * - `security`: exploit / auth / data-exposure / injection signals.
 *   IDOR, mass-assignment with persistence, missing-auth, open CORS,
 *   reflected XSS / CRLF in dangerous context.
 * - `reliability`: server crashes / 5xx on valid input / rate-limit
 *   absent / timeouts. Not security per se but production-impact.
 * - `contract`: spec ↔ runtime drift. Schema mismatch, wrong status
 *   codes, content-type negotiation failures, data-rejection contract
 *   violations, missing required headers.
 * - `hygiene`: static spec-lint, accept-without-impact, framework-level
 *   "could be intentional" signals, naming/style. Bulk volume lives here.
 */

export type Category = "security" | "reliability" | "contract" | "hygiene";

export const CATEGORY_ORDER: readonly Category[] = [
  "security",
  "reliability",
  "contract",
  "hygiene",
] as const;

/**
 * Category lookup by check-id / probe-class-id. Adding a new
 * finding-producer requires extending this map — the SARIF + reporter
 * tests assert full coverage so a missing entry fails loudly rather
 * than silently routing to a fallback.
 */
export const CATEGORY_BY_ID: Record<string, Category> = {
  // ── reliability ──────────────────────────────────────────────
  // 5xx on valid input is a server crash, not a security issue.
  not_a_server_error: "reliability",

  // ── contract ─────────────────────────────────────────────────
  // Spec-conformance checks. Server behaviour drifts from declared
  // contract — fix-worthy, but rarely security per se.
  status_code_conformance: "contract",
  content_type_conformance: "contract",
  response_headers_conformance: "contract",
  response_schema_conformance: "contract",
  missing_required_header: "contract",
  unsupported_method: "contract",
  // Data-rejection: server should reject malformed bodies per spec.
  // Falls under contract (spec said "reject", server accepted).
  negative_data_rejection: "contract",
  positive_data_acceptance: "contract",
  // m-20 state-aware probes — cross-resource contract invariants.
  cross_call_references: "contract",
  idempotency_replay: "contract",
  pagination_invariants: "contract",
  lifecycle_transitions: "contract",
  // ARV-256 (m-21) — small-team value-add. Rate-limit absence is a
  // production reliability concern, not a security exploit.
  rate_limit_headers_absent: "reliability",
  open_cors_on_sensitive: "security",

  // ── security ─────────────────────────────────────────────────
  ignored_auth: "security",
  use_after_free: "security",
  ensure_resource_availability: "security",
  // Probe classes
  "mass-assignment": "security",
  ssrf: "security",
  crlf: "security",
  xss: "security",
  sqli: "security",
  "open-redirect": "security",
  "path-traversal": "security",
  webhooks: "security",
};

/**
 * Map check-id / probe-class-id to category. Falls back to "hygiene"
 * for unknown ids — the SARIF reporter & tests assert this fallback
 * never triggers for registered checks/probes.
 */
export function categoryFor(id: string): Category {
  return CATEGORY_BY_ID[id] ?? "hygiene";
}

export function emptyCategoryBuckets(): Record<Category, number> {
  return { security: 0, reliability: 0, contract: 0, hygiene: 0 };
}

