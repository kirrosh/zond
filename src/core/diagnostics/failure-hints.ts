/**
 * Failure classification → closed-enum `recommended_action`.
 * ARV-338: prose hints (statusHint/envHint/softDeleteHint/schemaHint,
 * env_issue clustering, auth_hint, agent_directive) removed — the agent
 * triages by enum + raw evidence, not by heuristic guess-text.
 */

import { classify } from "../classifier/recommended-action.ts";

export function classifyFailure(status: string, responseStatus: number | null): "api_error" | "assertion_failed" | "network_error" {
  if (status === "error" && (responseStatus === null || responseStatus < 500)) return "network_error";
  if (responseStatus !== null && responseStatus >= 500) return "api_error";
  return "assertion_failed";
}

export type RecommendedAction =
  | "report_backend_bug"
  | "fix_auth_config"
  | "fix_test_logic"
  | "fix_network_config"
  | "fix_env"
  /** Fix the OpenAPI spec — emitted by lint-spec.Issue (TASK-294) and
   *  by `status_code_conformance` / `*_conformance` checks (ARV-11). */
  | "fix_spec"
  /** Add or correct a fixture in .env.yaml — emitted by discover for
   *  miss-* states (TASK-294). */
  | "fix_fixture"
  /** ARV-42 — generator-emitted suite produced a body the API rejected
   *  (4xx with validation hint). Editing the YAML is wrong: the next
   *  `zond generate` would clobber it. Re-run generate (or refine the
   *  spec/.api-resources hints) instead. */
  | "regenerate_suite"
  /** ARV-11 — server accepted an invalid request body. Backend should
   *  reject earlier; the test isn't wrong. */
  | "tighten_validation"
  /** ARV-11 — server didn't enforce a header marked `required: true`
   *  in the spec. Either enforce it, or drop `required` in the spec. */
  | "add_required_header"
  /** ARV-11 — known limitation that the team has accepted. Agents
   *  should not retry, file a bug, or include in dashboards. */
  | "wontfix_known_limitation";

export function recommendedAction(
  failureType: "api_error" | "assertion_failed" | "network_error",
  responseStatus: number | null,
): RecommendedAction {
  // ARV-56: delegate to the single classifier.
  const action = classify({
    finding_class: failureType === "api_error" ? "test:api_error" :
      failureType === "network_error" ? "test:network_error" : "test:assertion_failed",
    status: responseStatus,
  });
  // The three failure_type classes are total in the classifier — a missing
  // branch means a future refactor stripped one; surface loudly.
  if (!action) throw new Error(`classifier returned no action for failure_type=${failureType} status=${responseStatus}`);
  return action;
}

/**
 * ARV-42: extended recommender that knows whether the failing test was
 * emitted by `zond generate`. For generated suites, "fix_test_logic" is
 * actively misleading — the generated YAML carries the header
 * "⚠️ Edits will be overwritten on regenerate" and the next `zond audit`
 * really does clobber manual edits. Branch into the actually-actionable
 * remediation instead.
 *
 *  - 4xx (400/422) → regenerate_suite: the body the generator emitted
 *    didn't pass validation; either re-run generate (so newer heuristics
 *    apply, e.g. ARV-38 default-string) or tighten .api-resources hints.
 *  - 404 → fix_fixture: a path-param resolved to an empty / stale id
 *    in .env.yaml; `prepare-fixtures --seed` is the correct remedy.
 *  - everything else → falls back to recommendedAction (auth → 401/403,
 *    api_error → 5xx, etc.).
 *
 * `isGenerated` is the heuristic from db-analysis: provenance.type
 * "openapi-generated" OR suite_file under apis/<api>/tests/.
 */
export function recommendedActionForGenerated(
  failureType: "api_error" | "assertion_failed" | "network_error",
  responseStatus: number | null,
  isGenerated: boolean,
  schemaViolation = false,
): RecommendedAction {
  // ARV-56: delegate to classifier. `isGenerated` is encoded via a
  // synthetic suite_path so the same logic flows through classify().
  // ARV-103 (F8): `schemaViolation` propagates the assertion-kind flag —
  // when true, the classifier's "treat schema bugs like 5xx" branch wins
  // over the generator's regenerate_suite default.
  const action = classify({
    finding_class: failureType === "api_error" ? "test:api_error" :
      failureType === "network_error" ? "test:network_error" : "test:assertion_failed",
    status: responseStatus,
    ...(isGenerated ? { suite_path: "apis/_/tests/_.yaml" } : {}),
    ...(schemaViolation ? { schema_violation: true } : {}),
  });
  if (!action) throw new Error(`classifier returned no action for failure_type=${failureType} status=${responseStatus}`);
  return action;
}

/** ARV-42: classify a failing result row as generator-emitted. The two
 *  signals are independent — provenance is missing on older runs, while
 *  suite_file disambiguates against ad-hoc YAMLs the user dropped into
 *  apis/<api>/tests/ themselves (rare but supported). */
export function isGeneratedTest(
  provenance: { type?: string; generator?: string } | null | undefined,
  suite_file: string | null | undefined,
): boolean {
  if (provenance?.type === "openapi-generated") return true;
  if (provenance?.generator && provenance.generator.toLowerCase().includes("zond")) return true;
  if (typeof suite_file === "string" && /(^|\/)apis\/[^/]+\/tests\//.test(suite_file)) return true;
  return false;
}
