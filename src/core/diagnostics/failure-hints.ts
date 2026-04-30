/**
 * Failure classification and diagnostic hints.
 * Extracted from query-db.ts for reuse in Web UI.
 */

export function statusHint(status: number | null | undefined): string | null {
  if (!status) return null;
  if (status >= 500) return "Server-side error — inspect response_body for errorMessage/errorDetail; likely a backend bug";
  if (status === 401 || status === 403) return "Auth failure — check auth_token/api_key in .env.yaml";
  if (status === 404) return "Resource not found — verify the path and ID";
  if (status === 400 || status === 422) return "Validation error — check request body fields match the schema";
  if (status === 429) return "Rate limited — too many requests. Consider consolidating auth/login steps or adding delays between suites";
  return null;
}

export function classifyFailure(status: string, responseStatus: number | null): "api_error" | "assertion_failed" | "network_error" {
  if (status === "error" && (responseStatus === null || responseStatus < 500)) return "network_error";
  if (responseStatus !== null && responseStatus >= 500) return "api_error";
  return "assertion_failed";
}

export function envHint(url: string | null, errorMessage: string | null, envFilePath?: string): string | null {
  const envFile = envFilePath ? envFilePath : ".env.yaml in your API directory";

  if (url && /\{\{[^}]+\}\}/.test(url)) {
    return `URL contains unresolved variable: "${url}" — variable name may not match the key in ${envFile}`;
  }
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    return `base_url is not set or empty — URL resolved to "${url}". Add base_url to ${envFile}`;
  }
  if (errorMessage?.includes("base_url is not configured")) {
    return `base_url is missing or empty. Add base_url: https://your-api.com to ${envFile}`;
  }
  if (errorMessage?.includes("URL is invalid") || errorMessage?.includes("Failed to parse URL")) {
    return `URL is malformed — likely base_url is empty or invalid. Check base_url in ${envFile}`;
  }
  return null;
}

export type RecommendedAction =
  | "report_backend_bug"
  | "fix_auth_config"
  | "fix_test_logic"
  | "fix_network_config"
  | "fix_env";

export function recommendedAction(
  failureType: "api_error" | "assertion_failed" | "network_error",
  responseStatus: number | null,
): RecommendedAction {
  if (failureType === "api_error") return "report_backend_bug";
  if (failureType === "network_error") {
    if (responseStatus === 401 || responseStatus === 403) return "fix_auth_config";
    return "fix_network_config";
  }
  // assertion_failed
  if (responseStatus === 401 || responseStatus === 403) return "fix_auth_config";
  return "fix_test_logic";
}

export function envCategory(hint: string | undefined): string | null {
  if (!hint) return null;
  if (hint.includes("base_url is not set") || hint.includes("base_url is missing") || hint.includes("base_url is not configured")) return "base_url_missing";
  if (hint.includes("unresolved variable")) return "unresolved_variable";
  if (hint.includes("URL is malformed")) return "url_malformed";
  return null;
}

export function schemaHint(
  failureType: string,
  responseStatus: number | null | undefined,
): string | null {
  if (failureType === "assertion_failed" || responseStatus === 400 || responseStatus === 422) {
    return "Use describe_endpoint(specPath, method, path) to verify expected request/response schema";
  }
  return null;
}

export function softDeleteHint(
  actualStatus: number | null | undefined,
  requestMethod: string | null | undefined,
  responseBody: unknown,
): string | null {
  if (actualStatus !== 200 || requestMethod?.toUpperCase() !== "GET") return null;
  if (responseBody && typeof responseBody === "object") {
    const hasStatusField =
      "status" in (responseBody as object) ||
      "state" in (responseBody as object) ||
      "deleted" in (responseBody as object) ||
      "is_deleted" in (responseBody as object);
    if (hasStatusField) {
      return 'GET returned 200 with a status/state field after DELETE — likely soft delete. Update the test: remove the "Verify deleted → 404" step and instead assert the status field value (e.g. status: "cancelled")';
    }
  }
  return null;
}

export function computeSharedEnvIssue(
  failures: Array<{ hint?: string }>,
  envFilePath?: string,
): string | null {
  const categories = new Set(failures.map(f => envCategory(f.hint)).filter(Boolean));
  if (categories.size !== 1) return null;

  const envFile = envFilePath ?? ".env.yaml";
  if (categories.has("base_url_missing")) {
    return `All failures: base_url is not set — add base_url to ${envFile}`;
  }
  if (categories.has("unresolved_variable")) {
    return `All failures: some variables are not substituted — check variable names in ${envFile}`;
  }
  // url_malformed
  return [...failures.map(f => f.hint).filter(Boolean)][0] ?? null;
}

// ── TASK-98: per-suite env clustering ──────────────────────────────────────
//
// Round-3 review showed that the all-or-nothing run-level detector misses
// real env_issue scenarios: a single suite needs `{{stripe_key}}`, a webhook
// host is unreachable for one suite only, an auth token expires part-way
// through. Cluster classification — group by suite, flag a suite when ≥80%
// of its non-5xx failures share an env-symptom — closes that gap without
// laundering 5xx (real backend bugs) into env_issue.
export type EnvSymptom = "missing_var" | "base_url" | "url_malformed" | "auth_expired";

export function envSymptomOf(failure: {
  hint?: string;
  failure_type: string;
  response_status: number | null;
}): EnvSymptom | null {
  if (failure.failure_type === "api_error") return null; // 5xx never counted
  const cat = envCategory(failure.hint);
  if (cat === "unresolved_variable") return "missing_var";
  if (cat === "base_url_missing") return "base_url";
  if (cat === "url_malformed") return "url_malformed";
  if (failure.response_status === 401 || failure.response_status === 403) return "auth_expired";
  return null;
}

export interface EnvIssue {
  /** Human-readable summary; used by reporters and shown to the user. */
  message: string;
  /** "run" when the issue spans most/all suites; "suite:<name>" when localized. */
  scope: "run" | `suite:${string}`;
  /** Suites the env_issue covers — one entry for suite scope, ≥2 for run scope. */
  affected_suites: string[];
  /** Histogram of root-cause symptoms across affected failures. */
  symptoms: Partial<Record<EnvSymptom, number>>;
}

/**
 * Cluster non-5xx failures by suite and return per-suite env clusters that
 * meet the env-symptom threshold (default ≥80% AND ≥2 failures). 5xx are
 * excluded so backend bugs cannot be reclassified as env issues.
 */
export function clusterEnvIssues(
  failures: Array<{
    suite_name: string;
    hint?: string;
    failure_type: string;
    response_status: number | null;
  }>,
  threshold = 0.8,
): Array<{ suite: string; symptoms: Partial<Record<EnvSymptom, number>>; total: number }> {
  const bySuite = new Map<string, typeof failures>();
  for (const f of failures) {
    if (f.failure_type === "api_error") continue;
    const list = bySuite.get(f.suite_name) ?? [];
    list.push(f);
    bySuite.set(f.suite_name, list);
  }
  const clusters: Array<{ suite: string; symptoms: Partial<Record<EnvSymptom, number>>; total: number }> = [];
  for (const [suite, items] of bySuite) {
    if (items.length === 0) continue;
    const symptoms: Partial<Record<EnvSymptom, number>> = {};
    let envCount = 0;
    for (const f of items) {
      const s = envSymptomOf(f);
      if (s) {
        symptoms[s] = (symptoms[s] ?? 0) + 1;
        envCount++;
      }
    }
    if (envCount / items.length >= threshold && envCount >= 1) {
      clusters.push({ suite, symptoms, total: items.length });
    }
  }
  return clusters;
}

function formatSymptoms(symptoms: Partial<Record<EnvSymptom, number>>): string {
  const parts: string[] = [];
  for (const k of ["missing_var", "base_url", "url_malformed", "auth_expired"] as EnvSymptom[]) {
    const n = symptoms[k];
    if (n) parts.push(`${k}=${n}`);
  }
  return parts.join(", ");
}

/**
 * Build an EnvIssue envelope from clustered failures. Returns null when no
 * cluster exceeded the threshold. When exactly one suite is affected, scope
 * is `suite:<name>`; ≥2 suites collapse into a `run` scope aggregator.
 */
export function buildEnvIssue(
  clusters: Array<{ suite: string; symptoms: Partial<Record<EnvSymptom, number>>; total: number }>,
  envFilePath?: string,
): EnvIssue | null {
  if (clusters.length === 0) return null;
  const envFile = envFilePath ?? ".env.yaml";

  const merged: Partial<Record<EnvSymptom, number>> = {};
  for (const c of clusters) {
    for (const [k, v] of Object.entries(c.symptoms)) {
      merged[k as EnvSymptom] = (merged[k as EnvSymptom] ?? 0) + (v ?? 0);
    }
  }
  const affected_suites = clusters.map(c => c.suite).sort();

  if (clusters.length === 1) {
    const c = clusters[0]!;
    const breakdown = formatSymptoms(c.symptoms);
    return {
      message: `Suite "${c.suite}" looks env-broken (${breakdown}) — check ${envFile}`,
      scope: `suite:${c.suite}`,
      affected_suites,
      symptoms: merged,
    };
  }
  const breakdown = formatSymptoms(merged);
  return {
    message: `${clusters.length} suites look env-broken (${breakdown}) — check ${envFile}`,
    scope: "run",
    affected_suites,
    symptoms: merged,
  };
}
