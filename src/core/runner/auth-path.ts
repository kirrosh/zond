/**
 * Heuristic for "auth-shaped" endpoint paths used by `--safe` mode and
 * the env-symptom diagnostics in `db-analysis.ts`. Anything matching is
 * treated as a login/refresh route — `--safe` whitelists it for live
 * runs, and the diagnostics flag concentrated POST failures here as
 * `auth_required` rather than per-endpoint bugs.
 */
export const AUTH_PATH_RE = /\/(auth|login|signin|token|oauth)\b/i;
