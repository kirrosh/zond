/**
 * `x-zond-*` OpenAPI vendor-extension policy (ARV-189, m-21).
 *
 * Lets spec authors declare per-operation rules directly in the spec
 * without a sidecar yaml file. This is the low-friction alternative
 * to `.api-resources.local.yaml` for one-off endpoints — typical
 * cases:
 *   - public route that shouldn't be flagged for missing auth headers
 *   - debugging endpoint whose 500s aren't real bugs
 *   - one-off skip during incident triage
 *
 * Resolution priority (highest first):
 *   1. `.api-resources.local.yaml` overlay (explicit operator override)
 *   2. `x-zond-*` extensions (in-spec policy — this module)
 *   3. `.api-resources.yaml` (auto-generated baseline)
 *   4. built-in defaults
 *
 * Supported extensions in this milestone:
 *   x-zond-skip:    string | string[]  — check ids to skip for this op
 *   x-zond-public:  boolean             — shortcut: skip auth-class checks
 *
 * Deliberately NOT implemented yet (deferred to a follow-up task):
 *   x-zond-resource / x-zond-idempotent / x-zond-lifecycle-field —
 *   these require deeper m-20 overlay wiring (proper integration with
 *   resource-config maps), tracked separately to keep this MVP focused
 *   on the universally-useful skip rules.
 */

import type { EndpointInfo } from "../generator/types.ts";

/** Auth-related check ids that `x-zond-public: true` should suppress.
 *  Kept in sync with the auth-class check registry in mode.ts. */
const AUTH_CHECK_IDS = new Set<string>([
  "ignored_auth",
  "missing_required_header",
]);

/** True when the endpoint declares the check id should be skipped via
 *  any `x-zond-*` extension. The check id is matched case-sensitively
 *  against `x-zond-skip` entries; `x-zond-public: true` is expanded to
 *  the auth-id set before comparison. */
export function endpointSkipsCheck(op: EndpointInfo, checkId: string): boolean {
  const ext = op.extensions;
  if (!ext) return false;

  // x-zond-public: true → implicit skip for every auth-class check.
  if (ext["x-zond-public"] === true && AUTH_CHECK_IDS.has(checkId)) {
    return true;
  }

  // x-zond-skip: <string> | <string[]>
  const skip = ext["x-zond-skip"];
  if (typeof skip === "string") {
    return skip === checkId;
  }
  if (Array.isArray(skip)) {
    for (const entry of skip) {
      if (typeof entry === "string" && entry === checkId) return true;
    }
  }
  return false;
}

/** Reason string surfaced in the skipped-outcomes summary. Mirrors the
 *  `<check>: <reason>` convention used elsewhere in the runner. */
export function reasonForSkip(op: EndpointInfo, checkId: string): string {
  const ext = op.extensions;
  if (!ext) return "x-zond extension"; // shouldn't happen — caller gates on endpointSkipsCheck
  if (ext["x-zond-public"] === true && AUTH_CHECK_IDS.has(checkId)) {
    return "x-zond-public: true (auth check suppressed at the spec level)";
  }
  return `x-zond-skip listed "${checkId}" at the spec level`;
}
