import type { EndpointInfo, SecuritySchemeInfo } from "../../generator/types.ts";
import { generateFromSchema } from "../../generator/data-factory.ts";
import type { RawStep, RawSuite } from "../../generator/serializer.ts";
import { flattenToFormFields } from "../../runner/form-encode.ts";
import {
  captureFieldFor,
  convertPath,
  endpointStem,
  findDeleteCounterpart,
  getAuthHeaders,
} from "../shared.ts";
import type { SecurityProbeResult } from "./types.ts";

const ATTACK_EXPECTED_STATUS = [400, 403, 404, 405, 409, 415, 422];

function shortPayload(s: string): string {
  return s.length > 40 ? s.slice(0, 37) + "…" : s;
}

export function emitSecurityRegressionSuites(
  result: SecurityProbeResult,
  endpoints: EndpointInfo[],
  schemes: SecuritySchemeInfo[],
): RawSuite[] {
  const suites: RawSuite[] = [];
  for (const v of result.verdicts) {
    // ARV-247 (R-04/F18): `high` findings are 2xx-with-echoed-payload — the
    // strongest regression signal we have. Skipping them meant CI had nothing
    // to gate on for confirmed stored injections. Treat them like `ok` here:
    // the suite locks in the *expected* state (attack rejected) once the API
    // owner ships a fix, and fails loud while it's still broken.
    if (v.severity !== "ok" && v.severity !== "low" && v.severity !== "high") continue;
    const ep = endpoints.find(
      e => e.path === v.path && e.method.toUpperCase() === v.method,
    );
    if (!ep) continue;
    const suiteHeaders = getAuthHeaders(ep, schemes);
    const tests: RawStep[] = [];
    for (const f of v.findings) {
      // `ok` = attack already rejected; `high` = attack accepted+echoed (the
      // regression target is rejection, same expected set as `ok`). `low` =
      // attack accepted but no echo — lock in the 2xx-without-echo shape.
      const expected = (f.severity === "ok" || f.severity === "high") ? ATTACK_EXPECTED_STATUS : [200, 201, 202, 204];
      const body = ep.requestBodySchema ? generateFromSchema(ep.requestBodySchema) : {};
      if (typeof body === "object" && body !== null && !Array.isArray(body)) {
        (body as Record<string, unknown>)[f.field] = f.payload;
      }
      // ARV-161: mirror mass-assignment-probe — emit `form:` instead of
      // `json:` for form-urlencoded endpoints (Stripe v1), otherwise the
      // regression suite gets rejected with 400 "check that your POST
      // content type is application/x-www-form-urlencoded" and never
      // exercises the actual attack vector.
      const bodyField =
        ep.requestBodyContentType === "application/x-www-form-urlencoded"
          ? { form: flattenToFormFields(body) }
          : { json: body };
      const step: RawStep = {
        name: `${f.class}: ${f.field}=${shortPayload(f.payload)} must ${f.severity === "ok" ? "be rejected" : "not echo"}`,
        source: {
          generator: "probe-security",
          endpoint: `${v.method} ${v.path}`,
          response_branch: expected.map(String).join("|"),
        },
        [v.method]: convertPath(ep.path),
        ...bodyField,
        expect: { status: expected },
      };
      tests.push(step);
    }
    if (tests.length === 0) continue;
    // Attach a generic cleanup step keyed off `created_id` (only fires when
    // a previous step captured one — same `always:true` semantics other
    // probes use).
    const delEp = findDeleteCounterpart(ep, endpoints);
    if (delEp) {
      const idField = captureFieldFor(ep);
      tests[0]!.expect.body = { ...(tests[0]!.expect.body ?? {}), [idField]: { capture: "created_id" } };
      const idParam = (delEp.path.match(/\{([^}]+)\}/) ?? [])[1] ?? "id";
      const delStep: RawStep = {
        name: "cleanup",
        source: { generator: "probe-security-cleanup", endpoint: `DELETE ${delEp.path}` },
        always: true,
        DELETE: convertPath(delEp.path).replace(`{{${idParam}}}`, "{{created_id}}"),
        expect: { status: [200, 202, 204, 404] },
      } as RawStep & { always: boolean };
      tests.push(delStep);
    }
    suites.push({
      name: `probe-security ${v.method} ${v.path}`,
      tags: ["probe-security", ...result.classes],
      source: {
        type: "probe-suite",
        generator: "probe-security",
        endpoint: `${v.method} ${v.path}`,
      },
      fileStem: `probe-security-${endpointStem(ep)}`,
      base_url: "{{base_url}}",
      ...(suiteHeaders ? { headers: suiteHeaders } : {}),
      tests,
    });
  }
  return suites;
}
