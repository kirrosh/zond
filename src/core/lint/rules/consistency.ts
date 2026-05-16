import type { OpenAPIV3 } from "openapi-types";
import type { Issue, RuleId, Severity } from "../types.ts";
import { DEFAULT_SEVERITY } from "../types.ts";
import { RULE_AFFECTS } from "../affects.ts";
import type { SchemaContext } from "../walker.ts";
import { normalisedTypes } from "../walker.ts";
import { validateExampleAgainstFormat } from "../format.ts";

interface RuleSink {
  push(rule: RuleId, severity: Severity, message: string, opts: Partial<Pick<Issue, "path" | "method" | "fix_hint">> & { jsonpointer: string }): void;
}

export function runConsistencyRules(ctx: SchemaContext, sink: RuleSink): void {
  const s = ctx.schema;
  if (!s || typeof s !== "object") return;

  const types = normalisedTypes(s);
  const isStringy = types.includes("string");
  const isNumeric = types.includes("number") || types.includes("integer");

  const examples = collectExamples(s);
  for (const { value, pointer } of examples) {
    checkValueAgainstSchema(value, s, pointer, "example", isStringy, isNumeric, ctx, sink);
  }

  if (s.default !== undefined) {
    checkValueAgainstSchema(s.default, s, `${ctx.jsonpointer}/default`, "default", isStringy, isNumeric, ctx, sink);
  }

  // A6: enum values pairwise unique.
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    const seen = new Set<string>();
    let dupAt = -1;
    for (let i = 0; i < s.enum.length; i++) {
      const k = stableKey(s.enum[i]);
      if (seen.has(k)) { dupAt = i; break; }
      seen.add(k);
    }
    if (dupAt >= 0) {
      sink.push("A6", DEFAULT_SEVERITY.A6, `enum has duplicate value at index ${dupAt}`, {
        jsonpointer: `${ctx.jsonpointer}/enum/${dupAt}`,
        path: ctx.path, method: ctx.method,
        fix_hint: "remove the duplicate enum entry",
      });
    }
  }
}

function collectExamples(s: OpenAPIV3.SchemaObject): Array<{ value: unknown; pointer: string }> {
  const out: Array<{ value: unknown; pointer: string }> = [];
  if ((s as { example?: unknown }).example !== undefined) {
    out.push({ value: (s as { example: unknown }).example, pointer: "example" });
  }
  // OpenAPI 3.1 allows examples[]
  const arr = (s as { examples?: unknown }).examples;
  if (Array.isArray(arr)) {
    arr.forEach((v, i) => out.push({ value: v, pointer: `examples/${i}` }));
  }
  return out;
}

function checkValueAgainstSchema(
  value: unknown,
  s: OpenAPIV3.SchemaObject,
  basePointer: string,
  kind: "example" | "default",
  isStringy: boolean,
  isNumeric: boolean,
  ctx: SchemaContext,
  sink: RuleSink,
): void {
  // basePointer for example/default is sometimes a relative segment like "example".
  // Prepend ctx.jsonpointer if needed.
  const jsonpointer = basePointer.startsWith("/")
    ? basePointer
    : `${ctx.jsonpointer}/${basePointer}`;
  const ruleA1 = kind === "example" ? "A1" : "A5";
  const ruleA2 = kind === "example" ? "A2" : "A5";
  const ruleA3 = kind === "example" ? "A3" : "A5";
  const ruleA4 = kind === "example" ? "A4" : "A5";

  // Format check
  const fmt = (s as { format?: string }).format;
  if (fmt && isStringy && typeof value === "string") {
    if (!validateExampleAgainstFormat(value, fmt)) {
      sink.push(ruleA1, DEFAULT_SEVERITY[ruleA1], `${kind} ${JSON.stringify(value)} violates format: ${fmt}`, {
        jsonpointer, path: ctx.path, method: ctx.method,
        fix_hint: `make ${kind} match RFC for format: ${fmt}`,
      });
    }
  }

  // Enum check
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    const key = stableKey(value);
    if (!s.enum.some(e => stableKey(e) === key)) {
      sink.push(ruleA2, DEFAULT_SEVERITY[ruleA2], `${kind} ${JSON.stringify(value)} is not in enum`, {
        jsonpointer, path: ctx.path, method: ctx.method,
        fix_hint: `pick a value from enum: ${JSON.stringify(s.enum)}`,
      });
    }
  }

  // Pattern check
  const pattern = (s as { pattern?: string }).pattern;
  if (pattern && typeof value === "string") {
    let re: RegExp | null = null;
    try { re = new RegExp(pattern); } catch { /* invalid regex — skip silently */ }
    if (re && !re.test(value)) {
      sink.push(ruleA3, DEFAULT_SEVERITY[ruleA3], `${kind} ${JSON.stringify(value)} does not match pattern ${pattern}`, {
        jsonpointer, path: ctx.path, method: ctx.method,
        fix_hint: "adjust the example to match the regex",
      });
    }
  }

  // Length / range
  if (isStringy && typeof value === "string") {
    const min = (s as { minLength?: number }).minLength;
    const max = (s as { maxLength?: number }).maxLength;
    if (typeof min === "number" && value.length < min) {
      sink.push(ruleA4, DEFAULT_SEVERITY[ruleA4], `${kind} length ${value.length} < minLength ${min}`, {
        jsonpointer, path: ctx.path, method: ctx.method,
      });
    }
    if (typeof max === "number" && value.length > max) {
      sink.push(ruleA4, DEFAULT_SEVERITY[ruleA4], `${kind} length ${value.length} > maxLength ${max}`, {
        jsonpointer, path: ctx.path, method: ctx.method,
      });
    }
  }
  if (isNumeric && typeof value === "number") {
    const minimum = (s as { minimum?: number }).minimum;
    const maximum = (s as { maximum?: number }).maximum;
    if (typeof minimum === "number" && value < minimum) {
      sink.push(ruleA4, DEFAULT_SEVERITY[ruleA4], `${kind} ${value} < minimum ${minimum}`, {
        jsonpointer, path: ctx.path, method: ctx.method,
      });
    }
    if (typeof maximum === "number" && value > maximum) {
      sink.push(ruleA4, DEFAULT_SEVERITY[ruleA4], `${kind} ${value} > maximum ${maximum}`, {
        jsonpointer, path: ctx.path, method: ctx.method,
      });
    }
  }
}

function stableKey(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableKey).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableKey(obj[k])).join(",") + "}";
}

// Suppress unused-export warning: RULE_AFFECTS imported here for future inline
// affects-tagging if rules grow more local context.
void RULE_AFFECTS;
