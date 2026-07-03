import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import { flattenToFormFields } from "../../runner/form-encode.ts";
import type { RawStep, RawSuite } from "../../generator/serializer.ts";
import {
  captureFieldFor,
  convertPath,
  endpointStem,
  findDeleteCounterpart,
  findGetByIdCounterpart,
  getAuthHeaders,
} from "../shared.ts";
import { findIdParam } from "./classify.ts";
import type {
  EndpointVerdict,
  MassAssignmentResult,
} from "./types.ts";

const ACCEPTABLE_4XX = [400, 401, 403, 409, 415, 422];

/**
 * Emit YAML suites that lock in the safe behaviour observed during the live
 * run:
 *   • rejected (4xx) → assert status ∈ ACCEPTABLE_4XX (no regression to 2xx).
 *   • accepted-and-ignored → assert 2xx and that injected fields don't echo
 *     back. Follow-up GET — when available — additionally asserts the field
 *     is not persisted.
 *
 * "applied" / "inconclusive" are deliberately NOT emitted: those are bugs to
 * fix, not baselines to lock.
 */
export function emitRegressionSuites(
  result: MassAssignmentResult,
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
): RawSuite[] {
  const suites: RawSuite[] = [];
  for (const v of result.verdicts) {
    // ARV-250: "info" carries the post-pivot semantics of the old "low"
    // (extras silently ignored — useful regression even when severity is
    // demoted). Both "low" (inconclusive) and "info" (ignored) qualify
    // for the ignored-baseline suite.
    const isIgnoredCase = v.severity === "low" || v.severity === "info";
    if (v.severity !== "ok" && !isIgnoredCase) continue;
    const ep = endpoints.find(e => e.path === v.path && e.method.toUpperCase() === v.method);
    if (!ep) continue;
    const suiteHeaders = getAuthHeaders(ep, schemes);
    const probeExpectedStatus = v.severity === "ok" ? ACCEPTABLE_4XX : [200, 201, 202, 204];
    // ARV-150: emit `form:` instead of `json:` when the endpoint uses
    // form-urlencoded bodies — otherwise the regression suite would send
    // JSON and re-hit the original "wrong content-type" 400.
    const bodyField =
      ep.requestBodyContentType === "application/x-www-form-urlencoded"
        ? { form: flattenToFormFields(v.request.body) }
        : { json: v.request.body };
    const probeStep: RawStep = {
      name: `mass-assignment: extras must ${v.severity === "ok" ? "be rejected" : "not apply"}`,
      source: {
        generator: "mass-assignment-probe",
        endpoint: `${v.method} ${v.path}`,
        response_branch: probeExpectedStatus.map(String).join("|"),
      },
      [v.method]: convertPath(ep.path),
      ...bodyField,
      expect: {
        status: probeExpectedStatus,
      },
    };
    const tests: RawStep[] = [probeStep];
    // For ignored case + we have a follow-up GET → emit a verifying GET
    // that asserts injected fields are absent / overridden.
    if (isIgnoredCase && v.followUpGet) {
      const idField = captureFieldFor(ep);
      probeStep.expect.body = {
        ...(probeStep.expect.body ?? {}),
        [idField]: { capture: "created_id" },
      };
      const getEp = findGetByIdCounterpart(ep, endpoints);
      if (getEp) {
        const idParam = findIdParam(getEp);
        const getStep: RawStep = {
          name: `verify extras did not persist`,
          source: {
            generator: "mass-assignment-probe",
            endpoint: `GET ${getEp.path}`,
            response_branch: "200",
          },
          GET: convertPath(getEp.path).replace(`{{${idParam}}}`, "{{created_id}}"),
          expect: {
            status: 200,
            body: extrasNotEqualAssertions(v),
          },
        };
        tests.push(getStep);
      }
      // cleanup
      const delEp = findDeleteCounterpart(ep, endpoints);
      if (delEp) {
        const idParam = findIdParam(delEp);
        const delStep: RawStep = {
          name: "cleanup",
          source: {
            generator: "mass-assignment-probe-cleanup",
            endpoint: `DELETE ${delEp.path}`,
          },
          always: true,
          DELETE: convertPath(delEp.path).replace(`{{${idParam}}}`, "{{created_id}}"),
          expect: { status: [200, 202, 204, 404] },
        } as RawStep & { always: boolean };
        tests.push(delStep);
      }
    }
    suites.push({
      name: `mass-assignment ${v.method} ${v.path}`,
      tags: ["probe-mass-assignment", v.severity === "ok" ? "rejected-baseline" : "ignored-baseline"],
      source: {
        type: "probe-suite",
        generator: "mass-assignment-probe",
        endpoint: `${v.method} ${v.path}`,
      },
      fileStem: `mass-assignment-${endpointStem(ep)}`,
      base_url: "{{base_url}}",
      ...(suiteHeaders ? { headers: suiteHeaders } : {}),
      tests,
    });
  }
  return suites;
}

function extrasNotEqualAssertions(v: EndpointVerdict): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const f of v.fields) {
    if (f.outcome === "ignored" || f.outcome === "echoed-overwritten" || f.outcome === "absent") {
      // Assert the suspicious value did NOT take effect. We check that the
      // observed value (from the live GET) still holds — the API is allowed
      // to echo a server default; what's forbidden is echoing OUR sentinel.
      const expectedNotEqual = JSON.stringify(f.injected);
      out[f.field] = { not_equals: expectedNotEqual };
    }
  }
  return out;
}
