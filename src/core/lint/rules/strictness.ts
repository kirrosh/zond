import type { OpenAPIV3 } from "openapi-types";
import type { Issue, RuleId, Severity, HeuristicConfig } from "../types.ts";
import { DEFAULT_SEVERITY } from "../types.ts";
import type { ParamContext, ResponseContext, RequestBodyContext, SchemaContext } from "../walker.ts";
import { normalisedTypes } from "../walker.ts";

interface RuleSink {
  push(rule: RuleId, severity: Severity, message: string, opts: Partial<Pick<Issue, "path" | "method" | "fix_hint">> & { jsonpointer: string }): void;
}

/**
 * Group B — formal strictness gaps on parameters.
 * B1 (path-param without format/pattern) → high.
 * B3 (integer-param without min/max — pagination names get medium, others low).
 * B4 (cursor-name string-param without minLength: 1) → low.
 */
export function runParamStrictnessRules(ctx: ParamContext, sink: RuleSink, h: HeuristicConfig): void {
  const p = ctx.param;
  const schema = (p.schema ?? {}) as OpenAPIV3.SchemaObject;
  const types = normalisedTypes(schema);

  if (p.in === "path" && types.includes("string")) {
    // Only flag string path-params: integer/number params have type-level
    // constraints (minimum/maximum, multipleOf), so missing format/pattern
    // is benign there.
    const hasFormat = !!(schema as { format?: string }).format;
    const hasPattern = !!(schema as { pattern?: string }).pattern;
    if (!hasFormat && !hasPattern) {
      sink.push("B1", DEFAULT_SEVERITY.B1, `path-param "${p.name}" missing format/pattern`, {
        jsonpointer: ctx.jsonpointer, path: ctx.path, method: ctx.method,
        fix_hint: "add format: uuid (or pattern: ^...$) so SDKs reject malformed values client-side",
      });
    }
  }

  if (types.includes("integer") || types.includes("number")) {
    const hasMin = typeof (schema as { minimum?: unknown }).minimum === "number";
    const hasMax = typeof (schema as { maximum?: unknown }).maximum === "number";
    if (!hasMin || !hasMax) {
      const isPagination = h.pagination_names.some(n => n.toLowerCase() === p.name.toLowerCase());
      const sev: Severity = isPagination ? "medium" : "low";
      const which = !hasMin && !hasMax ? "minimum/maximum" : !hasMin ? "minimum" : "maximum";
      sink.push("B3", sev, `${p.in}-param "${p.name}" (${types.join("|")}) missing ${which}`, {
        jsonpointer: ctx.jsonpointer, path: ctx.path, method: ctx.method,
        fix_hint: `add ${which} so out-of-range values are rejected before reaching the server`,
      });
    }
  }

  if (types.includes("string") && h.cursor_names.some(n => n.toLowerCase() === p.name.toLowerCase())) {
    const minLen = (schema as { minLength?: unknown }).minLength;
    if (typeof minLen !== "number" || minLen < 1) {
      sink.push("B4", DEFAULT_SEVERITY.B4, `cursor-param "${p.name}" missing minLength: 1`, {
        jsonpointer: ctx.jsonpointer, path: ctx.path, method: ctx.method,
        fix_hint: "add minLength: 1 so empty cursor strings are rejected client-side",
      });
    }
  }
}

/**
 * B7 — 2xx response without a JSON schema. `--validate-schema` silently skips
 * such endpoints, masking real type drift.
 */
export function runResponseStrictnessRules(ctx: ResponseContext, sink: RuleSink): void {
  const status = parseInt(ctx.status, 10);
  if (!Number.isFinite(status) || status < 200 || status >= 300) return;
  // 204 No Content / 205 Reset Content / 304 Not Modified by definition carry no body.
  if (status === 204 || status === 205) return;
  const r = ctx.response;
  const hasJsonSchema = r.content && Object.entries(r.content).some(([ct, mt]) => {
    return ct.includes("json") && (mt.schema !== undefined);
  });
  if (!hasJsonSchema) {
    sink.push("B7", DEFAULT_SEVERITY.B7, `${ctx.status} response missing JSON schema`, {
      jsonpointer: ctx.jsonpointer, path: ctx.path, method: ctx.method,
      fix_hint: "declare content.application/json.schema so --validate-schema can verify the response",
    });
  }
}

/**
 * B8 — request-body root schema without explicit `additionalProperties`.
 * Informational; tied to mass-assignment risk (T58).
 */
export function runRequestBodyStrictnessRules(ctx: RequestBodyContext, sink: RuleSink): void {
  if (!ctx.requestBody.content) return;
  for (const [ct, mt] of Object.entries(ctx.requestBody.content)) {
    if (!ct.includes("json")) continue;
    const schema = mt.schema as OpenAPIV3.SchemaObject | undefined;
    if (!schema) continue;
    const ap = (schema as { additionalProperties?: unknown }).additionalProperties;
    if (ap === undefined) {
      sink.push("B8", DEFAULT_SEVERITY.B8, `request body schema does not set additionalProperties`, {
        jsonpointer: `${ctx.jsonpointer}/content/${ct.replace(/~/g, "~0").replace(/\//g, "~1")}/schema`,
        path: ctx.path, method: ctx.method,
        fix_hint: "set additionalProperties: false to make mass-assignment vectors explicit",
      });
    }
  }
}

/**
 * Schema-level B-rules that aren't on parameters: currently empty placeholder
 * for future expansion (e.g. response-body B5 picked up via heuristics).
 */
export function runSchemaStrictnessRules(_ctx: SchemaContext, _sink: RuleSink): void {
  // intentionally empty — heuristic schema-level checks live in heuristics.ts
}
