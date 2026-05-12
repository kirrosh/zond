/**
 * ARV-124: migrated from `src/core/checks/checks/_anti_fp.ts` (guard #2).
 *
 * The classic "stringified primitive" trap: schema says `integer`, our
 * mutation flips to `"42"` (string), but servers using Express,
 * FastAPI, Rails coerce the string back to int. The mutation is a
 * no-op on the wire, so a 2xx isn't a real silent-accept.
 *
 * Sources: schemathesis #2312, #2978.
 */
import type { CheckCase } from "../../../checks/types.ts";
import type { MutationMeta } from "../../../checks/checks/_negative_mutator.ts";
import type { FpRule } from "../../types.ts";

function getMutation(c: CheckCase): MutationMeta | undefined {
  const m = c.meta as { mutation?: MutationMeta["mutation"] } | undefined;
  if (!m || typeof m.mutation !== "string") return undefined;
  return c.meta as unknown as MutationMeta;
}

export const stringTypeMutationBecomesValidRule: FpRule<CheckCase> = {
  id: "_string_type_mutation_becomes_valid_after_serialization",
  scope: "check:negative_data_rejection",
  references: ["#2312", "#2978"],
  applies(c) {
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
          ruleId: "_string_type_mutation_becomes_valid_after_serialization",
          scope: "check:negative_data_rejection",
          reason: `value "${v}" is numerically coerceable — server may auto-cast`,
          references: ["#2312", "#2978"],
        };
      }
      if (fromBoolean && (v === "true" || v === "false")) {
        return {
          ruleId: "_string_type_mutation_becomes_valid_after_serialization",
          scope: "check:negative_data_rejection",
          reason: `value "${v}" is boolean-coerceable — server may auto-cast`,
          references: ["#2312"],
        };
      }
    }
    return null;
  },
};
