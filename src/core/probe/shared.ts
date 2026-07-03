/**
 * Shared helpers for probe generators (negative-probe, mass-assignment-probe).
 */
import type { OpenAPIV3 } from "openapi-types";
import type { EndpointInfo, SecuritySchemeInfo } from "../generator/types.ts";

export function convertPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, "{{$1}}");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build a short, distinguishable alias for an OpenAPI path-param name —
 * used to keep probe filenames readable when several `{...id}` segments
 * collapse to the same `by-id` (TASK-159, m-9 P3).
 *
 *   organization_id_or_slug → "org"
 *   project_id_or_slug      → "proj"
 *   replay_id               → "replay"
 *   userId                  → "user"
 *   foo                     → "foo"
 *   id                      → "id"
 *
 * The general rule: drop trailing `_id` / `_slug` / `_or_slug` /
 * `Id` / `Slug`, then slugify and trim to the first segment. We also
 * canonicalise a couple of common common SaaS-style names to short aliases
 * (`organization` → `org`, `project` → `proj`).
 */
export function placeholderAlias(rawName: string): string {
  let name = rawName.trim();
  // Strip the OpenAPI noisy suffixes.
  name = name.replace(/_or_slug$/i, "");
  name = name.replace(/(_id|_slug)$/i, "");
  name = name.replace(/(Id|Slug)$/g, "");
  const slug = slugify(name);
  if (!slug || slug === "id") return "id";
  // Canonical short aliases for frequent long names.
  const canonical: Record<string, string> = {
    organization: "org",
    project: "proj",
    repository: "repo",
    environment: "env",
    application: "app",
    integration: "intg",
    notification: "notif",
  };
  const first = slug.split("-")[0]!;
  if (canonical[first]) return canonical[first];
  // Fall back to the slug, capped at 12 chars so really long names don't
  // blow up the filename.
  return slug.length > 12 ? slug.slice(0, 12) : slug;
}

/**
 * Replace every `{name}` segment in an OpenAPI path with `by-<alias>`,
 * preserving placeholder identity (TASK-159).
 */
export function pathWithByAliases(path: string): string {
  return path.replace(/\{([^}]+)\}/g, (_, name) => `by-${placeholderAlias(name)}`);
}

export function endpointStem(ep: EndpointInfo): string {
  const path = pathWithByAliases(ep.path)
    .replace(/^\//, "")
    .replace(/\//g, "-");
  return slugify(`${ep.method.toLowerCase()}-${path}`);
}

export function getAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  tokenVarFor?: (s: SecuritySchemeInfo) => string,
): Record<string, string> | undefined {
  if (ep.security.length === 0) return undefined;
  const tokenVar = (s: SecuritySchemeInfo) => tokenVarFor?.(s) ?? "auth_token";

  // Prefer bearer / apiKey schemes over basic when an endpoint declares
  // multiple alternatives (ARV-147). Stripe v1 publishes `security: [basicAuth,
  // bearerAuth]` with both pointing at the same `auth_token` value, but
  // basicAuth expects base64(user:password) — feeding it a raw `sk_test_…`
  // produces a 401. zond request already hardcodes Bearer for this reason
  // (send-request.ts TASK-231); the generator + probes now agree by walking
  // ep.security twice: first looking for a non-basic match, then falling
  // back to basic only if nothing else worked.
  const tryScheme = (scheme: SecuritySchemeInfo): Record<string, string> | undefined => {
    if (scheme.type === "http") {
      if (scheme.scheme === "bearer" || !scheme.scheme) {
        return { Authorization: `Bearer {{${tokenVar(scheme)}}}` };
      }
      if (scheme.scheme === "basic") {
        return { Authorization: `Basic {{${tokenVar(scheme)}}}` };
      }
    }
    if (scheme.type === "apiKey" && scheme.in === "header" && scheme.apiKeyName) {
      if (scheme.apiKeyName === "Authorization") {
        return { Authorization: `Bearer {{${tokenVar(scheme)}}}` };
      }
      return { [scheme.apiKeyName]: "{{api_key}}" };
    }
    return undefined;
  };

  const isBasic = (s: SecuritySchemeInfo): boolean =>
    s.type === "http" && s.scheme === "basic";

  // Pass 1: skip basic.
  for (const secName of ep.security) {
    const scheme = schemes.find((s) => s.name === secName);
    if (!scheme || isBasic(scheme)) continue;
    const headers = tryScheme(scheme);
    if (headers) return headers;
  }
  // Pass 2: basic-only fallback.
  for (const secName of ep.security) {
    const scheme = schemes.find((s) => s.name === secName);
    if (!scheme || !isBasic(scheme)) continue;
    const headers = tryScheme(scheme);
    if (headers) return headers;
  }
  return undefined;
}

/** Path with placeholders replaced by valid-but-nonexistent IDs. */
function pathWithPlaceholders(ep: EndpointInfo, badId: string): string {
  return ep.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const param = ep.parameters.find((p) => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    if (badId === "valid-shape") {
      if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
      if (schema?.type === "integer" || schema?.type === "number") return "999999999";
      return "nonexistent-zzzzz";
    }
    return badId;
  });
}

/**
 * Render a path for probe execution. The "attacked" param (if any) is replaced
 * with `attacked.value`; remaining params are rendered as either runtime
 * placeholders (`{{name}}`, resolved from `.env.yaml` by `zond run`) when
 * `useRealParents=true`, or as synthetic-by-type sentinels in the legacy mode.
 *
 * The output is the final path string written into the YAML — no further
 * `convertPath` pass is required (and would in fact corrupt the doubled
 * braces).
 *
 * Why `useRealParents` exists (TASK-135 / m-8): probe-validation used to bake
 * `nonexistent-zzzzz` into every parent path-param, which short-circuits to
 * 404 on real APIs (e.g. `/orgs/zzzzz/repos/{repo}/commits` never reaches the
 * `{repo}` validator). Using the real parent slug from the env restores
 * recall — the API actually walks past the parent and starts validating the
 * leaf, so 5xx bugs there become observable.
 */
export function renderPath(
  ep: EndpointInfo,
  attacked: { name: string; value: string } | null,
  opts: { useRealParents: boolean },
): string {
  return ep.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    if (attacked && name === attacked.name) return attacked.value;
    if (opts.useRealParents) return `{{${name}}}`;
    const param = ep.parameters.find((p) => p.name === name && p.in === "path");
    const schema = param?.schema as OpenAPIV3.SchemaObject | undefined;
    if (schema?.format === "uuid") return "00000000-0000-0000-0000-000000000000";
    if (schema?.type === "integer" || schema?.type === "number") return "999999999";
    return "nonexistent-zzzzz";
  });
}

/** ARV-244/ARV-245: percent-encode unsafe characters per path segment,
 *  preserving anything already percent-encoded (`%XX`). Slashes, the
 *  unreserved set, and a conservative slice of sub-delims are kept
 *  verbatim. Used both for orphan-cleanup DELETE URLs and paste-ready
 *  manual repro lines in the security-probe digest. */
export function encodePathForRepro(deletePath: string): string {
  const SAFE = /[A-Za-z0-9._~!$&'()*+,;=:@-]/;
  return deletePath
    .split("/")
    .map((segment) => {
      if (segment.length === 0) return segment;
      let out = "";
      for (let i = 0; i < segment.length; i++) {
        const ch = segment.charAt(i);
        if (ch === "%" && /^[0-9A-Fa-f]{2}$/.test(segment.slice(i + 1, i + 3))) {
          out += segment.slice(i, i + 3);
          i += 2;
          continue;
        }
        out += SAFE.test(ch) ? ch : encodeURIComponent(ch);
      }
      return out;
    })
    .join("/");
}

export function isMutating(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH";
}

/**
 * TASK-259: pre-run banner shown to stderr before any mutating probe runs
 * on a live API. Lists the probe's name and reminds the user that:
 *   1. resources will be created and deleted on the target;
 *   2. seeded `.env.yaml` fixtures (slug/id/name) may go stale because
 *      probes may rename or replace them;
 *   3. `--no-cleanup` keeps created resources around for inspection.
 *
 * Emits to stderr (not stdout) so it doesn't pollute --json envelopes or
 * the Markdown digest. Suppressed when `quiet` is true (used in CI/JSON
 * paths where the structured envelope already carries warnings).
 */
export function printMutationBanner(
  probeName: string,
  vars: Record<string, string>,
  opts?: { quiet?: boolean },
): void {
  if (opts?.quiet) return;
  const fixtureKeys = Object.keys(vars).filter((k) =>
    /(_id|_slug|_uuid|_name|_token)$/i.test(k) || /^(monitor|project|team|alert_rule|rule|organization)_id_or_slug$/.test(k),
  );
  const fixtureLine = fixtureKeys.length > 0
    ? `   FK fixtures that may go stale: ${fixtureKeys.slice(0, 8).join(", ")}${fixtureKeys.length > 8 ? `, +${fixtureKeys.length - 8} more` : ""}\n`
    : "";
  process.stderr.write(
    `\n` +
    `⚠  ${probeName} mutates live data on the target API.\n` +
    `   It creates and (by default) deletes resources via POST/PUT/PATCH/DELETE.\n` +
    `${fixtureLine}` +
    `   Recovery if FK fixtures change: re-run \`zond prepare-fixtures --api <name>\` to refresh \`.env.yaml\`.\n` +
    `   Pass \`--no-cleanup\` to keep probe-created resources for inspection.\n` +
    `\n`,
  );
}

/**
 * TASK-259: count probe verdicts whose cleanup DELETE was attempted but
 * failed (network error, or 4xx other than 404). 404 is intentionally
 * treated as success: the resource is gone, possibly already removed by
 * the API itself or by the test under inspection. Used to surface an
 * "N orphans, manual cleanup needed" line in the CLI summary.
 */
/**
 * TASK-264: does this OpenAPI path template have ANY `{param}` segment
 * whose name matches a non-empty entry in `vars` (a seeded fixture)?
 * Used by `--isolated` to gate PUT/PATCH/DELETE attacks.
 *
 * Permissive on the var-side: we treat `audience_id`, `audience-slug`,
 * `audience` as the same fixture so spec-naming variations don't leak.
 */
export function pathTouchesSeededVar(path: string, vars: Record<string, string>): boolean {
  const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]!);
  if (placeholders.length === 0) return false;
  const filledKeys = new Set(
    Object.keys(vars).filter(k => {
      const v = vars[k];
      return typeof v === "string" && v.trim().length > 0;
    }).map(k => k.toLowerCase().replace(/[-_]/g, "")),
  );
  for (const ph of placeholders) {
    const norm = ph.toLowerCase().replace(/[-_]/g, "");
    if (filledKeys.has(norm)) return true;
    // Strip the OpenAPI noisy suffixes (e.g. `_id`, `_or_slug`) and try again.
    const stripped = norm.replace(/(idorslug|orslug|id|slug)$/i, "");
    if (stripped && filledKeys.has(stripped)) return true;
  }
  return false;
}

export function countCleanupFailures(
  verdicts: Array<{ cleanup?: { attempted: boolean; status?: number; error?: string } }>,
): number {
  let n = 0;
  for (const v of verdicts) {
    const c = v.cleanup;
    if (!c || !c.attempted) continue;
    if (c.error) { n++; continue; }
    if (c.status != null && c.status >= 400 && c.status !== 404) n++;
  }
  return n;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip a single trailing slash so `/keys/` and `/keys` compare equal.
 * common SaaS-style APIs mix both forms; without this normalisation, the
 * counterpart lookup misses on every collection that ends in `/`,
 * leaking created resources during probe runs.
 */
function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function pathsEqual(a: string, b: string): boolean {
  return stripTrailingSlash(a) === stripTrailingSlash(b);
}

/**
 * Find DELETE counterpart for resource-creating endpoint:
 *  - POST  /collection           → DELETE /collection/{id}
 *  - PUT   /collection/{id}      → DELETE /collection/{id}
 *  - PATCH /collection/{id}      → DELETE /collection/{id}
 *
 *  Trailing-slash tolerant on both sides (TASK-139-style fix carried
 *  into shared.ts after round-4 dogfooding showed a real-world `POST /keys/`
 *  leaked DSN keys because the regex required identical slash forms).
 */
export function findDeleteCounterpart(
  ep: EndpointInfo,
  all: EndpointInfo[],
): EndpointInfo | undefined {
  const m = ep.method.toUpperCase();
  const base = stripTrailingSlash(ep.path);
  if (m === "POST") {
    const re = new RegExp(`^${escapeRegex(base)}/\\{[^}]+\\}/?$`);
    return all.find(e => e.method.toUpperCase() === "DELETE" && !e.deprecated && re.test(e.path));
  }
  if (m === "PUT" || m === "PATCH") {
    return all.find(e => e.method.toUpperCase() === "DELETE" && !e.deprecated && pathsEqual(e.path, ep.path));
  }
  return undefined;
}

/**
 * Find GET-by-id counterpart for follow-up reads after a mutating request:
 *  - POST  /collection           → GET /collection/{id}
 *  - PUT   /collection/{id}      → GET /collection/{id}    (same path)
 *  - PATCH /collection/{id}      → GET /collection/{id}    (same path)
 *
 *  See `findDeleteCounterpart` for the trailing-slash rationale.
 */
export function findGetByIdCounterpart(
  ep: EndpointInfo,
  all: EndpointInfo[],
): EndpointInfo | undefined {
  const m = ep.method.toUpperCase();
  const base = stripTrailingSlash(ep.path);
  if (m === "POST") {
    const re = new RegExp(`^${escapeRegex(base)}/\\{[^}]+\\}/?$`);
    return all.find(e => e.method.toUpperCase() === "GET" && !e.deprecated && re.test(e.path));
  }
  if (m === "PUT" || m === "PATCH") {
    return all.find(e => e.method.toUpperCase() === "GET" && !e.deprecated && pathsEqual(e.path, ep.path));
  }
  return undefined;
}

/** Pick the response field that holds the new resource's id. */
export function captureFieldFor(ep: EndpointInfo): string {
  const success = ep.responses.find(r => r.statusCode >= 200 && r.statusCode < 300 && r.schema);
  const schema = success?.schema;
  if (schema?.properties) {
    if ("id" in schema.properties) return "id";
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      const s = propSchema as OpenAPIV3.SchemaObject;
      if (s.type === "integer" || s.format === "uuid") return name;
    }
  }
  return "id";
}

export function headersEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Resolve auth headers with live values from `vars` (used by probe runtimes
 * and path-discovery). Mirrors `getAuthHeaders` but produces concrete header
 * values, not `{{auth_token}}` placeholders.
 */
export function liveAuthHeaders(
  ep: EndpointInfo,
  schemes: SecuritySchemeInfo[],
  vars: Record<string, string>,
): Record<string, string> {
  if (ep.security.length === 0) {
    // ARV-218 (R15/F25): for bare specs (no components.securitySchemes,
    // empty per-endpoint .security — GitHub publishes its OpenAPI this
    // way), zond's workspace-level conventions still wire `auth_token`
    // end-to-end (ARV-201 seeds it in .env.yaml; zond request — see
    // resolveAdHocRequest — auto-attaches `Authorization: Bearer
    // {{auth_token}}`). Mirror that fallback into the live-call path so
    // probes (mass-assignment / security) and stateful create-steps don't
    // 401 their baseline on these specs. Without this, the whole
    // depth-pass on GitHub-style APIs stays unauth even after ARV-212
    // emitted the suite-level Bearer header for `zond run`.
    if (schemes.length === 0) {
      const tok = vars["auth_token"];
      if (typeof tok === "string" && tok.length > 0) {
        return { Authorization: `Bearer ${tok}` };
      }
    }
    return {};
  }

  // Two-pass walk: prefer bearer/apiKey over basic (ARV-148, mirrors the
  // generator-side fix in `getAuthHeaders` above). Without this, every
  // prepare-fixtures discover/seed request on Stripe-style APIs picks the
  // first declared scheme (basicAuth) and ships the raw `sk_test_…` token
  // as Basic Auth credentials → Stripe base64-decodes the garbage and
  // returns 401 across 98/98 vars.
  const tryScheme = (scheme: SecuritySchemeInfo): Record<string, string> | undefined => {
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
    return undefined;
  };

  const isBasic = (s: SecuritySchemeInfo): boolean =>
    s.type === "http" && s.scheme === "basic";

  // Pass 1: skip basic.
  for (const secName of ep.security) {
    const scheme = schemes.find(s => s.name === secName);
    if (!scheme || isBasic(scheme)) continue;
    const headers = tryScheme(scheme);
    if (headers) return headers;
  }
  // Pass 2: basic fallback.
  for (const secName of ep.security) {
    const scheme = schemes.find(s => s.name === secName);
    if (!scheme || !isBasic(scheme)) continue;
    const headers = tryScheme(scheme);
    if (headers) return headers;
  }
  return {};
}

// ──────────────────────────────────────────────
// ARV-153: semantic classification of POST operations
// ──────────────────────────────────────────────

/**
 * ARV-153: action verbs that, when they appear as the last path segment,
 * mark a POST as "operates on an existing resource" rather than
 * "allocates a new one". A DELETE counterpart is meaningless for these —
 * there's nothing to delete because nothing new was created.
 *
 * Examples that fit this pattern:
 *   POST /v1/charges/{id}/capture
 *   POST /v1/customers/{id}/sources/{src}/verify
 *   POST /v1/payment_intents/{id}/cancel
 *   POST /v1/users/{id}/activate
 *   POST /api/messages/{id}/resend
 *
 * Compound forms ("mark-as-read", "send-email", "verify-otp") are also
 * recognised — we look at the first slug segment ("mark", "send", "verify").
 *
 * Conservative on purpose: a misclassified create-resource attacked without
 * cleanup leaks. Verbs that double as nouns ("filter", "lock"…) are kept
 * out; add only when a real-world spec proves the false-positive risk is
 * lower than the recall win.
 */
const ACTION_VERBS = new Set([
  "accept", "acknowledge", "activate", "approve", "archive", "attach",
  "cancel", "capture", "check", "claim", "clone", "close", "complete",
  "confirm", "copy", "deactivate", "decline", "decrypt", "demote", "deploy",
  "detach", "disable", "disconnect", "dismiss", "dispatch", "duplicate",
  "enable", "encrypt", "execute", "expire", "export", "fail", "finalize",
  "fork", "ignore", "import", "invalidate", "invite", "link", "lookup",
  "merge", "mute", "notify", "pause", "ping", "preview", "process",
  "promote", "publish", "purge", "queue", "reactivate", "rebuild", "redeem",
  "refresh", "refund", "register", "reject", "release", "remind",
  "render", "renew", "reopen", "report", "reprocess", "request", "resend",
  "reset", "resolve", "restart", "restore", "resubmit", "resume", "retry",
  "revert", "review", "revoke", "rollback", "rotate", "run", "schedule",
  "search", "send", "settle", "share", "snooze", "start", "stop", "submit",
  "subscribe", "suspend", "swap", "sync", "test", "transfer", "trigger",
  "unarchive", "unassign", "unblock", "unlink", "unlock", "unmute",
  "unpublish", "unshare", "unsubscribe", "unsuspend", "validate", "verify",
  "void", "withdraw",
]);

export type PostSemantics = "action" | "create-resource" | "unknown";

/** ARV-153: classify a POST endpoint by looking at the last path segment.
 *  Returns "action" when the verb at the tail clearly identifies the
 *  operation as a side-effecting verb against an existing resource (no
 *  new resource allocated → no DELETE counterpart needed). Conservative:
 *  unknown verbs fall back to "create-resource", which keeps the existing
 *  cleanup-feasibility gate intact for safety. */
export function classifyPostSemantics(ep: EndpointInfo): PostSemantics {
  if (ep.method.toUpperCase() !== "POST") return "unknown";
  const segments = ep.path.split("/").filter(Boolean);
  if (segments.length === 0) return "unknown";
  const last = segments[segments.length - 1]!.toLowerCase();
  if (last.startsWith("{")) return "unknown";
  if (ACTION_VERBS.has(last)) return "action";
  // Compound action forms: "mark-as-read", "send-email", "verify-otp",
  // "request_reset", "do.export". Use first slug as the verb candidate.
  const head = last.split(/[-_.]/)[0]!;
  if (head && ACTION_VERBS.has(head)) return "action";
  return "create-resource";
}

export function hasJsonBody(ep: EndpointInfo): boolean {
  return (
    ep.method !== "GET" &&
    ep.method !== "DELETE" &&
    ep.requestBodyContentType === "application/json" &&
    ep.requestBodySchema !== undefined
  );
}
