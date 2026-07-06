/**
 * `not_a_server_error` — schemathesis-equivalent baseline check: a
 * well-formed request must never produce a 5xx response. Acts as the
 * seed check for the ARV-1 scaffolding; the rest of the conformance
 * suite lands in ARV-2.
 */
import type { Check } from "../types.ts";

export const notAServerError: Check = {
  id: "not_a_server_error",
  severity: "high",
  defaultExpected: "Server must not respond with 5xx for any well-formed request",
  references: [
    { id: "RFC-9110-15.6", url: "https://www.rfc-editor.org/rfc/rfc9110#name-server-error-5xx" },
  ],
  // ARV-340: evaluate malformed-input cases too, not just the positive
  // baseline. A negative_data / missing-header request is still a
  // well-formed HTTP request the server must handle with a 4xx — a 5xx
  // there is an unhandled crash (live Stripe: GET /v1/billing/alerts 500
  // on a bad query param slipped through when this defaulted to positive
  // only). `unsupported_method` is excluded on purpose: 501/405 to an
  // undeclared method is legitimate, not a server error.
  caseKinds: ["positive", "negative_data", "missing_required_header"],
  applies: () => true,
  run({ response }) {
    if (response.status >= 500 && response.status < 600) {
      return {
        kind: "fail",
        message: `Server responded with ${response.status} (5xx) — request triggered an unhandled error`,
        evidence: { status: response.status },
      };
    }
    return { kind: "pass" };
  },
};
