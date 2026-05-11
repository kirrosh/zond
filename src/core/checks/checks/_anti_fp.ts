/**
 * Anti-FP guards for the data-rejection checks (m-15 ARV-4). Names and
 * intent mirror schemathesis' `_negative_data_rejection` /
 * `_positive_data_acceptance` helpers — a finding is suppressed when
 * any guard returns a reason. These exist because schemathesis' bug
 * tracker has years of "false positive on coerced int/string" and
 * "form-encoded body that re-validates" issues; copying the guards
 * avoids re-treading the same churn.
 *
 * Source references for each guard map to closed schemathesis issues:
 *   #2312 — string→int coercion FP   → string_type_mutation_becomes_valid
 *   #2482 — form-encoded body re-valid → body_negation_becomes_valid
 *   #2713 — multiple disjoint mutations → has_unverifiable_mutations
 *   #2726 — querystring serialisation → body_negation_becomes_valid
 *   #2978 — URL-encoded numeric coercion → string_type_mutation_becomes_valid
 *   #3712 — multipart re-validation     → body_negation_becomes_valid
 */
import type { CheckCase } from "../types.ts";
import type { MutationMeta } from "./_negative_mutator.ts";

export interface GuardSkip {
  reason: string;
  guard: string;
  /** Backing schemathesis issue numbers — useful for finding evidence. */
  references?: string[];
}

function getMutation(c: CheckCase): MutationMeta | undefined {
  const m = c.meta as { mutation?: MutationMeta["mutation"] } | undefined;
  if (!m || typeof m.mutation !== "string") return undefined;
  return c.meta as unknown as MutationMeta;
}

function isFormLike(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return (
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  );
}

/**
 * Guard #1 — `_body_negation_becomes_valid_after_serialization`.
 * Form-encoded / multipart bodies often *re-validate* after wire
 * serialisation: empty strings round-trip as missing, dropped optional
 * fields default at the server, numeric strings coerce. When the
 * mutation is a drop/empty-string on a form-shaped request, suppress.
 *
 * Sources: schemathesis #2482, #2726, #3712.
 */
export function bodyNegationBecomesValidAfterSerialization(
  c: CheckCase,
): GuardSkip | null {
  const m = getMutation(c);
  if (!m) return null;
  const ct = c.request.headers["Content-Type"] ?? c.request.headers["content-type"];
  if (!isFormLike(ct)) return null;
  if (m.mutation === "drop_required" || m.mutation === "constraint_violation") {
    return {
      guard: "_body_negation_becomes_valid_after_serialization",
      reason: `mutation "${m.mutation}" on a ${ct} body re-validates after wire serialisation`,
      references: ["#2482", "#2726", "#3712"],
    };
  }
  return null;
}

/**
 * Guard #2 — `_string_type_mutation_becomes_valid_after_serialization`.
 * The classic "stringified primitive" trap: schema says `integer`, our
 * mutation flips to `"42"` (string), but servers using Express,
 * FastAPI, Rails coerce the string back to int. The mutation is a
 * no-op on the wire, so a 2xx isn't a real ignore.
 *
 * Sources: schemathesis #2312, #2978.
 */
export function stringTypeMutationBecomesValidAfterSerialization(
  c: CheckCase,
): GuardSkip | null {
  const m = getMutation(c);
  if (!m || m.mutation !== "type_mutation") return null;
  const fromNumeric = m.from_type === "integer" || m.from_type === "number";
  const fromBoolean = m.from_type === "boolean";
  const toString = m.to_type === "string" || typeof m.to_value === "string";
  if (!toString) return null;
  if (fromNumeric || fromBoolean) {
    const v = String(m.to_value);
    if (fromNumeric && /^-?\d+(\.\d+)?$/.test(v)) {
      return {
        guard: "_string_type_mutation_becomes_valid_after_serialization",
        reason: `value "${v}" is numerically coerceable — server may auto-cast`,
        references: ["#2312", "#2978"],
      };
    }
    if (fromBoolean && (v === "true" || v === "false")) {
      return {
        guard: "_string_type_mutation_becomes_valid_after_serialization",
        reason: `value "${v}" is boolean-coerceable — server may auto-cast`,
        references: ["#2312"],
      };
    }
  }
  return null;
}

/**
 * Guard #3 — `_has_unverifiable_mutations`.
 * Multiple disjoint mutations make accept/reject ambiguous: the server
 * might accept due to one site even while rejecting another. Our
 * single-site mutator emits exactly one mutation, so the guard fires
 * only when callers attach `mutation_count > 1` to `case.meta` — used
 * by future shrinkers / batched probes.
 *
 * Source: schemathesis #2713.
 */
export function hasUnverifiableMutations(c: CheckCase): GuardSkip | null {
  const meta = c.meta as { mutation_count?: number } | undefined;
  if (!meta) return null;
  if (typeof meta.mutation_count === "number" && meta.mutation_count > 1) {
    return {
      guard: "_has_unverifiable_mutations",
      reason: `${meta.mutation_count} mutations on disjoint sites — finding can't be attributed`,
      references: ["#2713"],
    };
  }
  return null;
}

/**
 * Guard #4 — `_coverage_phase_boundary_positive`.
 * `--phase coverage` enumerates boundary values across the body schema:
 *   - shortest/longest string, min/max int, every enum option, ...
 * Those bodies are JSON-Schema-valid but semantically synthetic — they
 * sit on the contract edge. Real APIs reject them with 422 for reasons
 * that have nothing to do with the contract:
 *   - "from" email must be on a verified-sending-domain,
 *   - "broadcast.from_audience_id" must exist on this tenant,
 *   - rate-limited resource (Resend plan_limit).
 * Treating each one as `positive_data_acceptance` fail floods the report
 * (171/349 findings on Resend round-03) and drowns real depth signal.
 * Skip when the case is a coverage-phase positive — keep the
 * examples-phase positive (one realistic baseline body) as the strict
 * signal.
 *
 * Source: feedback round-03 F20 / ARV-77.
 */
export function coveragePhaseBoundaryPositive(c: CheckCase): GuardSkip | null {
  const meta = c.meta as { phase?: string } | undefined;
  if (!meta || meta.phase !== "coverage") return null;
  if (c.kind !== "positive") return null;
  return {
    guard: "_coverage_phase_boundary_positive",
    reason: "boundary-positive bodies are synthetic — server may reject for semantic reasons unrelated to the contract",
  };
}

export const ALL_GUARDS = [
  bodyNegationBecomesValidAfterSerialization,
  stringTypeMutationBecomesValidAfterSerialization,
  hasUnverifiableMutations,
  coveragePhaseBoundaryPositive,
] as const;

/** Run every guard; return the first skip reason or null. */
export function applyGuards(c: CheckCase): GuardSkip | null {
  for (const g of ALL_GUARDS) {
    const r = g(c);
    if (r) return r;
  }
  return null;
}
