/**
 * Unified operation filter (m-15 ARV-9).
 *
 * Parses `--include`/`--exclude` filter specs in a single grammar so
 * `zond run`, `zond checks`, `zond probe`, and `zond generate` all
 * accept the same `<selector>:<value>` strings without each command
 * inventing its own flag set.
 *
 * Grammar:
 *
 *   <spec> := <selector> ":" <value>
 *   <selector> := "path" | "method" | "tag" | "operation-id" | "operationId"
 *   <value>:
 *     path        — POSIX-style regex matched against `op.path`
 *     method      — comma-separated HTTP methods, case-insensitive
 *     tag         — comma-separated tag names, exact match (case-sensitive)
 *     operation-id — POSIX-style regex matched against `op.operationId`
 *
 * Semantics:
 *   - Multiple `--include` flags combine with OR (op passes if it
 *     matches *any* include); when no include is given, every op is
 *     considered included.
 *   - `--exclude` always removes a match — combines with OR too.
 *   - Excludes are evaluated *after* includes.
 *
 * Errors are returned in a `errors[]` array on the compile result so
 * the CLI can surface a friendly multi-line message instead of a
 * stack trace (AC #4).
 */
import type { EndpointInfo } from "../generator/types.ts";

export type SelectorKind = "path" | "method" | "tag" | "operation-id";

const SELECTOR_ALIASES: Record<string, SelectorKind> = {
  path: "path",
  method: "method",
  tag: "tag",
  "operation-id": "operation-id",
  operationid: "operation-id",
  operation_id: "operation-id",
};

export interface ParsedSelector {
  kind: SelectorKind;
  raw: string;
  /** Regex form for `path` and `operation-id` selectors. */
  pattern?: RegExp;
  /** Lowercase token list for `method`/`tag` selectors. */
  values?: string[];
}

export type ParseResult =
  | { ok: true; selector: ParsedSelector }
  | { ok: false; error: string };

export function parseFilterSpec(spec: string): ParseResult {
  const idx = spec.indexOf(":");
  if (idx <= 0) {
    return { ok: false, error: `Filter "${spec}": expected "<selector>:<value>" (e.g. path:/users/.*)` };
  }
  const head = spec.slice(0, idx).trim().toLowerCase();
  const tail = spec.slice(idx + 1).trim();
  if (tail.length === 0) {
    return { ok: false, error: `Filter "${spec}": value is empty after "${head}:"` };
  }
  const kind = SELECTOR_ALIASES[head];
  if (!kind) {
    const known = Object.keys(SELECTOR_ALIASES).filter((k) => k === SELECTOR_ALIASES[k]).join(", ");
    return { ok: false, error: `Filter "${spec}": unknown selector "${head}". Known: ${known}` };
  }

  if (kind === "path" || kind === "operation-id") {
    let pattern: RegExp;
    try {
      pattern = new RegExp(tail);
    } catch (err) {
      return { ok: false, error: `Filter "${spec}": invalid regex — ${(err as Error).message}` };
    }
    return { ok: true, selector: { kind, raw: spec, pattern } };
  }

  // method / tag — comma-separated.
  const values = tail.split(",").map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) {
    return { ok: false, error: `Filter "${spec}": no values after "${head}:"` };
  }
  if (kind === "method") {
    return { ok: true, selector: { kind, raw: spec, values: values.map((v) => v.toUpperCase()) } };
  }
  return { ok: true, selector: { kind, raw: spec, values } };
}

function selectorMatches(sel: ParsedSelector, op: EndpointInfo): boolean {
  switch (sel.kind) {
    case "path":
      return sel.pattern!.test(op.path);
    case "method":
      return sel.values!.includes(op.method.toUpperCase());
    case "tag":
      return op.tags.some((t) => sel.values!.includes(t));
    case "operation-id":
      return op.operationId !== undefined && sel.pattern!.test(op.operationId);
  }
}

export interface CompileFilterOptions {
  includes?: string[];
  excludes?: string[];
}

export interface CompiledFilter {
  filter: (op: EndpointInfo) => boolean;
  errors: string[];
  /** Parsed selectors — handy for debug `--explain` output. */
  parsed: { includes: ParsedSelector[]; excludes: ParsedSelector[] };
}

export function compileOperationFilter(opts: CompileFilterOptions = {}): CompiledFilter {
  const errors: string[] = [];
  const includes: ParsedSelector[] = [];
  const excludes: ParsedSelector[] = [];
  for (const raw of opts.includes ?? []) {
    const r = parseFilterSpec(raw);
    if (r.ok) includes.push(r.selector);
    else errors.push(r.error);
  }
  for (const raw of opts.excludes ?? []) {
    const r = parseFilterSpec(raw);
    if (r.ok) excludes.push(r.selector);
    else errors.push(r.error);
  }
  const filter = (op: EndpointInfo): boolean => {
    if (includes.length > 0) {
      const passInclude = includes.some((s) => selectorMatches(s, op));
      if (!passInclude) return false;
    }
    for (const s of excludes) {
      if (selectorMatches(s, op)) return false;
    }
    return true;
  };
  return { filter, errors, parsed: { includes, excludes } };
}

