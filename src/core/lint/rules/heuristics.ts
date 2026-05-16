import type { OpenAPIV3 } from "openapi-types";
import type { Issue, RuleId, Severity, HeuristicConfig } from "../types.ts";
import { DEFAULT_SEVERITY } from "../types.ts";
import type { ParamContext, SchemaContext, RequestBodyContext } from "../walker.ts";
import { normalisedTypes } from "../walker.ts";

interface RuleSink {
  push(rule: RuleId, severity: Severity, message: string, opts: Partial<Pick<Issue, "path" | "method" | "fix_hint">> & { jsonpointer: string }): void;
}

/**
 * B2 — path/query param named like an id (`*_id`, `id`) without `format: uuid`
 * or `pattern`. Heuristic: only on params whose name matches the id-suffix list.
 */
export function runParamHeuristics(ctx: ParamContext, sink: RuleSink, h: HeuristicConfig): void {
  const p = ctx.param;
  if (p.in !== "path" && p.in !== "query") return;
  const schema = (p.schema ?? {}) as OpenAPIV3.SchemaObject;
  const types = normalisedTypes(schema);
  // B2 only applies to string-shaped ids (uuid). Integer ids are constrained
  // by minimum/maximum (B3 territory), not by format: uuid.
  if (types.length > 0 && !types.includes("string")) return;
  const looksLikeId = p.name === "id" || h.id_suffixes.some(s => p.name.endsWith(s));
  if (!looksLikeId) return;
  const fmt = (schema as { format?: string }).format;
  const hasPattern = !!(schema as { pattern?: string }).pattern;
  if (fmt !== "uuid" && !hasPattern) {
    sink.push("B2", DEFAULT_SEVERITY.B2, `id-like param "${p.name}" missing format: uuid or pattern (heuristic)`, {
      jsonpointer: ctx.jsonpointer, path: ctx.path, method: ctx.method,
      fix_hint: "if the id is a UUID, add format: uuid; otherwise add a pattern",
    });
  }
}

/**
 * B5/B6 — schema property name suggests a known semantic type, but `format`
 * is missing.
 *   - `*_at`, `*_date`, `*_time`, `created`, `updated`, `timestamp` → `date-time`
 *   - `email`, `url`, `website`, `homepage` → `email` / `uri`
 */
export function runSchemaHeuristics(ctx: SchemaContext, sink: RuleSink, h: HeuristicConfig): void {
  if (ctx.origin !== "property" || !ctx.propertyName) return;
  const s = ctx.schema;
  const types = normalisedTypes(s);
  if (!types.includes("string")) return;
  const fmt = (s as { format?: string }).format;
  const name = ctx.propertyName;

  // B5 — timestamp fields
  const looksLikeTimestamp =
    h.timestamp_suffixes.some(suf => name.endsWith(suf)) ||
    ["created", "updated", "timestamp"].includes(name);
  if (looksLikeTimestamp && fmt !== "date-time" && fmt !== "date") {
    sink.push("B5", DEFAULT_SEVERITY.B5, `field "${name}" looks like a timestamp but has no format: date-time (heuristic)`, {
      jsonpointer: ctx.jsonpointer, path: ctx.path, method: ctx.method,
      fix_hint: "add format: date-time so --validate-schema enforces RFC3339",
    });
  }

  // B6 — email / url
  if (name === "email" && fmt !== "email") {
    sink.push("B6", DEFAULT_SEVERITY.B6, `field "${name}" missing format: email (heuristic)`, {
      jsonpointer: ctx.jsonpointer, path: ctx.path, method: ctx.method,
      fix_hint: "add format: email",
    });
  }
  if (h.url_names.includes(name) && fmt !== "uri" && fmt !== "url") {
    sink.push("B6", DEFAULT_SEVERITY.B6, `field "${name}" missing format: uri (heuristic)`, {
      jsonpointer: ctx.jsonpointer, path: ctx.path, method: ctx.method,
      fix_hint: "add format: uri",
    });
  }
}

/**
 * B9 — request-body schema declares semantically-required-looking properties
 * (`name`, `email`, `title`) but `required: []` is empty / absent. Heuristic.
 */
export function runRequestBodyHeuristics(ctx: RequestBodyContext, sink: RuleSink, h: HeuristicConfig): void {
  if (!ctx.requestBody.content) return;
  for (const [ct, mt] of Object.entries(ctx.requestBody.content)) {
    if (!ct.includes("json")) continue;
    const schema = mt.schema as OpenAPIV3.SchemaObject | undefined;
    if (!schema || !schema.properties) continue;
    const required = (schema.required ?? []) as string[];
    const propNames = Object.keys(schema.properties);
    const semanticPresent = h.semantic_required.filter(n => propNames.includes(n));
    const semanticMissing = semanticPresent.filter(n => !required.includes(n));
    if (semanticPresent.length > 0 && semanticMissing.length === semanticPresent.length) {
      sink.push("B9", DEFAULT_SEVERITY.B9, `request body has properties [${semanticPresent.join(", ")}] but none are required (heuristic)`, {
        jsonpointer: `${ctx.jsonpointer}/content/${ct.replace(/~/g, "~0").replace(/\//g, "~1")}/schema/required`,
        path: ctx.path, method: ctx.method,
        fix_hint: `consider adding to required: [${semanticMissing.map(n => `"${n}"`).join(", ")}]`,
      });
    }
  }
}
