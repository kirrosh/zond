/**
 * TASK-101: failure classification — definitely_bug / likely_bug / quirk / env_issue.
 *
 * Goal: бэкендер за секунду видит «реально баг» vs «quirk зонда / probe
 * фолс-позитив». Чисто read-only классификация: не меняет статус step,
 * не влияет на pass/fail. Только tag-овая аналитика.
 */

import type { StepResult, AssertionResult } from "../runner/types.ts";
import type { SourceMetadata } from "../parser/types.ts";

export type FailureClass = "definitely_bug" | "likely_bug" | "quirk" | "env_issue";

export interface FailureClassification {
  failure_class: FailureClass;
  failure_class_reason: string;
}

function failedAssertionsOf(result: StepResult): AssertionResult[] {
  return result.assertions.filter((a) => !a.passed);
}

function ruleStartsWith(a: AssertionResult, prefix: string): boolean {
  return typeof a.rule === "string" && a.rule.startsWith(prefix);
}

function expectedStatusList(a: AssertionResult): number[] | null {
  if (Array.isArray(a.expected)) {
    const arr = a.expected.filter((v): v is number => typeof v === "number");
    return arr.length > 0 ? arr : null;
  }
  return typeof a.expected === "number" ? [a.expected] : null;
}

/**
 * Classify a failed step. Returns `null` for pass/skip/unclassifiable failures —
 * UI renders those as "unclassified" rather than crashing.
 */
export function classifyFailure(result: StepResult): FailureClassification | null {
  if (result.status === "pass" || result.status === "skip") return null;

  // Network/runtime error before any HTTP response → env-side
  if (result.status === "error") {
    return {
      failure_class: "env_issue",
      failure_class_reason: result.error ?? "request failed before producing a response",
    };
  }

  const respStatus = result.response?.status;
  const provenance: SourceMetadata | null | undefined = result.provenance;
  const generator = typeof provenance?.generator === "string" ? provenance.generator : undefined;
  const failed = failedAssertionsOf(result);

  // 1. Backend 5xx — always a backend bug regardless of test intent.
  if (typeof respStatus === "number" && respStatus >= 500) {
    return {
      failure_class: "definitely_bug",
      failure_class_reason: `API returned ${respStatus} — server-side error`,
    };
  }

  // 2. Response did not match its OpenAPI schema — spec guarantees X, server returned ≠ X.
  const schemaFail = failed.find((a) => ruleStartsWith(a, "schema."));
  if (schemaFail) {
    return {
      failure_class: "definitely_bug",
      failure_class_reason: `Response violates OpenAPI schema at ${schemaFail.field}`,
    };
  }

  // 3. Mass-assignment probe: extras must not apply. A failed not_equals
  //    assertion on this generator means the sentinel value leaked through.
  if (generator === "mass-assignment-probe") {
    const extrasLeak = failed.find(
      (a) => ruleStartsWith(a, "not_equals") || ruleStartsWith(a, "set_equals"),
    );
    if (extrasLeak) {
      return {
        failure_class: "definitely_bug",
        failure_class_reason: `Mass-assignment: client-supplied extras were accepted (${extrasLeak.field})`,
      };
    }
  }

  // 4. Negative-probe family — distinguish "API accepted bad input" (likely_bug)
  //    from "API rejected with a different 4xx" (quirk).
  if (generator === "negative-probe" || generator === "method-probe") {
    const statusFail = failed.find((a) => a.field === "status");
    if (statusFail && typeof respStatus === "number") {
      const expected = expectedStatusList(statusFail);
      const allExpected4xx = expected?.every((s) => s >= 400 && s < 500) ?? false;
      if (allExpected4xx) {
        if (respStatus >= 200 && respStatus < 300) {
          return {
            failure_class: "likely_bug",
            failure_class_reason: `Negative probe expected 4xx, got ${respStatus} — API accepts invalid input`,
          };
        }
        if (respStatus >= 400 && respStatus < 500) {
          return {
            failure_class: "quirk",
            failure_class_reason: `Negative probe expected ${expected!.join("/")}, got ${respStatus} — different 4xx code`,
          };
        }
      }
    }
  }

  // Default: leave unclassified. UI / CLI render as "unclassified".
  return null;
}
