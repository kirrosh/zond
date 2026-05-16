/**
 * ARV-124: migrated from `src/core/checks/checks/_anti_fp.ts` (guard #1).
 *
 * Form-encoded / multipart bodies often *re-validate* after wire
 * serialisation: empty strings round-trip as missing, dropped optional
 * fields default at the server, numeric strings coerce. When the
 * mutation is a drop/empty-string on a form-shaped request, the
 * negative_data_rejection finding would be a false positive — the
 * mutation is a no-op on the wire.
 *
 * Sources: schemathesis #2482, #2726, #3712.
 */
import type { CheckCase } from "../../../checks/types.ts";
import type { MutationMeta } from "../../../checks/checks/_negative_mutator.ts";
import type { FpRule } from "../../types.ts";

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

export const bodyNegationBecomesValidRule: FpRule<CheckCase> = {
  id: "_body_negation_becomes_valid_after_serialization",
  scope: "check:negative_data_rejection",
  references: ["#2482", "#2726", "#3712"],
  applies(c) {
    const m = getMutation(c);
    if (!m) return null;
    const ct =
      c.request.headers["Content-Type"] ?? c.request.headers["content-type"];
    if (!isFormLike(ct)) return null;
    if (m.mutation === "drop_required" || m.mutation === "constraint_violation") {
      return {
        ruleId: "_body_negation_becomes_valid_after_serialization",
        scope: "check:negative_data_rejection",
        reason: `mutation "${m.mutation}" on a ${ct} body re-validates after wire serialisation`,
        references: ["#2482", "#2726", "#3712"],
      };
    }
    return null;
  },
};
