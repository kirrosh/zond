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
