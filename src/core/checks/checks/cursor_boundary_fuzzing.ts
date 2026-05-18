/**
 * `cursor_boundary_fuzzing` (ARV-273) — fuzz cursor/page-token style
 * query parameters on list endpoints with malformed values. The server
 * is expected to reject with 400/422 (or 401/403 if the path is auth-
 * gated). A 5xx response on *any* well-formed cursor value is a real
 * bug (Stripe `/v1/billing/alerts` was found this way during the m-22
 * Stripe scan).
 *
 * Detection rule: parameter `name` matches a small set of conventional
 * cursor names (cursor / starting_after / ending_before / after /
 * before / page_token / next_token / continuation), parameter is
 * `in: "query"`, and schema type is string (or untyped — many SDKs
 * leave the cursor schema open).
 *
 * Mutation vectors (7): empty string, numeric, "null", very-long
 * string (200 chars), valid-shape-wrong-resource (Stripe-id), SQL-
 * shaped (`' OR 1=1--`), JSON-shaped (`{"foo":"bar"}`).
 *
 * Severity ladder:
 *   - any 5xx → HIGH (server should never crash on bad cursor)
 *   - any 2xx/204 → LOW (server silently tolerates a malformed cursor)
 *   - 4xx other than 4xx-expected → no finding (server rejected — good)
 *   - 401/403 only → skip (auth-gated, not the check's concern)
 *
 * Why not done by `negative_data_rejection`: that check mutates one
 * value per case based on the declared schema (string → integer,
 * integer overflow, etc.). Cursor fuzzing is a *cross-API convention*
 * fuzz family that does not derive from schema type; we know these
 * are cursor-shaped strings and we know the standard malformations
 * that crash naive cursor parsers.
 */
import type { OpenAPIV3 } from "openapi-types";
import type { CrudStatefulCheck } from "../stateful.ts";
import type { CheckOutcome, Severity } from "../types.ts";
import { fillPathParams } from "./_crud-helpers.ts";

const CURSOR_PARAM_NAME_RE = /^(cursor|starting_after|ending_before|after|before|page_token|next_token|continuation)$/i;

interface MutationVector {
  label: string;
  value: string;
}

const MUTATION_VECTORS: readonly MutationVector[] = [
  { label: "empty", value: "" },
  { label: "numeric", value: "12345" },
  { label: "null-literal", value: "null" },
  { label: "very-long", value: "a".repeat(200) },
  { label: "wrong-resource-id", value: "cus_invalid_zzz" },
  { label: "sql-shaped", value: "' OR 1=1--" },
  { label: "json-shaped", value: '{"foo":"bar"}' },
];

function isCursorParam(p: OpenAPIV3.ParameterObject): boolean {
  if (p.in !== "query") return false;
  if (!CURSOR_PARAM_NAME_RE.test(p.name)) return false;
  const schema = p.schema as OpenAPIV3.SchemaObject | undefined;
  if (!schema) return true;
  // Accept untyped schemas (many specs leave cursor open) and string.
  if (!schema.type) return true;
  return schema.type === "string";
}

function buildUrl(
  base: string,
  path: string,
  pathVars: Record<string, string> | undefined,
  cursorParam: string,
  cursorValue: string,
): string {
  const url = `${base.replace(/\/+$/, "")}${fillPathParams(path, pathVars)}`;
  const qs = new URLSearchParams();
  qs.append(cursorParam, cursorValue);
  return `${url}?${qs.toString()}`;
}

interface VectorOutcome {
  param: string;
  vector: string;
  status: number;
  body_excerpt?: string;
}

function excerpt(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  const trimmed = s.length > n ? s.slice(0, n) + "…" : s;
  return trimmed;
}

export const cursorBoundaryFuzzing: CrudStatefulCheck = {
  id: "cursor_boundary_fuzzing",
  // Per-finding severity overrides via outcome.severity: 5xx → high, 2xx → low.
  // Declared baseline 'low' so it doesn't dominate per-check gating tables.
  severity: "low",
  defaultExpected:
    "Cursor-style query params (cursor / starting_after / page_token / …) must reject malformed values with 4xx, never 5xx",
  references: [{ id: "ARV-273" }],
  phase: "crud",
  applies(g) {
    if (!g.list) return false;
    return g.list.parameters.some(isCursorParam);
  },
  async run(g, h): Promise<CheckOutcome> {
    if (h.bootstrapCleanupFailed) {
      return { kind: "skip", reason: "bootstrap-cleanup failed — stateful checks paused" };
    }
    const list = g.list!;
    const cursorParams = list.parameters.filter(isCursorParam);
    if (cursorParams.length === 0) {
      return { kind: "skip", reason: "no cursor-style query params on list endpoint" };
    }

    const baseHeaders = { Accept: "application/json", ...h.authHeaders };
    const serverErrors: VectorOutcome[] = [];
    const silentAccepts: VectorOutcome[] = [];
    let totalAttempted = 0;
    let allAuthGated = true;

    for (const param of cursorParams) {
      for (const vec of MUTATION_VECTORS) {
        const url = buildUrl(h.baseUrl, list.path, h.pathVars, param.name, vec.value);
        let resp;
        try {
          resp = await h.send({ method: "GET", url, headers: baseHeaders });
        } catch {
          continue;
        }
        totalAttempted += 1;
        const status = resp.status;
        if (status !== 401 && status !== 403) allAuthGated = false;
        if (status >= 500 && status < 600) {
          serverErrors.push({
            param: param.name,
            vector: vec.label,
            status,
            body_excerpt: excerpt(resp.body, 240),
          });
        } else if (status >= 200 && status < 300) {
          silentAccepts.push({
            param: param.name,
            vector: vec.label,
            status,
          });
        }
      }
    }

    if (totalAttempted === 0) {
      return { kind: "skip", reason: "no mutations dispatched (network errors on every probe)" };
    }
    if (allAuthGated) {
      return { kind: "skip", reason: "endpoint auth-gated for all probes (401/403 only)" };
    }
    if (serverErrors.length > 0) {
      const sev: Severity = "high";
      const first = serverErrors[0]!;
      return {
        kind: "fail",
        severity: sev,
        message:
          `Server returned ${first.status} on ${first.vector} cursor (${first.param}) — ${serverErrors.length}/${totalAttempted} mutation(s) hit 5xx`,
        evidence: {
          resource: g.resource,
          list_path: list.path,
          kind: "server_error_on_bad_cursor",
          cursor_params: cursorParams.map((p) => p.name),
          attempted: totalAttempted,
          server_errors: serverErrors,
        },
      };
    }
    if (silentAccepts.length > 0) {
      return {
        kind: "fail",
        severity: "low",
        message:
          `Server returned 2xx on ${silentAccepts.length}/${totalAttempted} malformed cursor mutation(s) — likely silent tolerance of bad input`,
        evidence: {
          resource: g.resource,
          list_path: list.path,
          kind: "silent_accept_on_bad_cursor",
          cursor_params: cursorParams.map((p) => p.name),
          attempted: totalAttempted,
          accepts: silentAccepts,
        },
      };
    }
    return { kind: "pass" };
  },
};
