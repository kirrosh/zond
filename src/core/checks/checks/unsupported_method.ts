/**
 * `unsupported_method` — the live-running counterpart of the offline
 * `method-probe`. Sends a method that isn't declared on the path; the
 * server must reject with a 405 (or 401/403/404 fallback). Shares the
 * acceptable-status list with the offline probe via `method-shared`
 * (ARV-2 AC #4).
 */
import type { Check } from "../types.ts";
import {
  ACCEPTABLE_UNSUPPORTED_STATUSES,
  isPermissibleOptionsResponse,
} from "../../probe/method-shared.ts";

const ACCEPTABLE = new Set<number>(ACCEPTABLE_UNSUPPORTED_STATUSES);

export const unsupportedMethod: Check = {
  id: "unsupported_method",
  severity: "medium",
  defaultExpected: "Server must reject undeclared HTTP methods with 405 (or 401/403/404)",
  references: [{ id: "RFC-9110-15.5.6", url: "https://www.rfc-editor.org/rfc/rfc9110#name-405-method-not-allowed" }],
  caseKinds: ["unsupported_method"],
  applies: () => true,
  run({ case: c, response, options }) {
    const status = response.status;
    const undeclared = String(c.meta?.undeclared_method ?? c.request.method);
    const strict = options?.strict405 === true;

    // ARV-179: OPTIONS 2xx is legitimate CORS preflight behaviour on
    // almost every framework. Treat as pass even in strict mode — the
    // m-18 parity replication explicitly ignores OPTIONS responses too.
    if (isPermissibleOptionsResponse(undeclared, status)) return { kind: "pass" };

    if (strict) {
      if (status === 405) return { kind: "pass" };
      return {
        kind: "fail",
        message: `Undeclared method ${undeclared} returned ${status} — strict mode requires 405`,
        evidence: { undeclared_method: undeclared, status, strict_405: true },
      };
    }

    if (ACCEPTABLE.has(status)) return { kind: "pass" };
    if (status >= 200 && status < 300) {
      return {
        kind: "fail",
        message: `Server accepted undeclared method ${undeclared} on ${c.operation.path} (status ${status})`,
        evidence: { undeclared_method: undeclared, status },
      };
    }
    if (status >= 500) {
      return {
        kind: "fail",
        message: `Server 5xx'd on undeclared method ${undeclared} for ${c.operation.path} — should be 405`,
        evidence: { undeclared_method: undeclared, status },
      };
    }
    return {
      kind: "fail",
      message: `Undeclared method ${undeclared} returned ${status} — expected 405 (or 401/403/404)`,
      evidence: { undeclared_method: undeclared, status },
    };
  },
};
