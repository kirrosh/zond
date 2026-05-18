/**
 * ARV-283 Phase A: `when:` condition matcher.
 *
 * Pure evaluator — given a context object (built from a CheckFinding +
 * resolved request/response) and a ConditionMap, returns true iff
 * every condition matches (AND semantics).
 *
 * Path grammar (deliberately tight — Phase A locks down a small set
 * so DSL doesn't drift):
 *
 *   response.status                  → number
 *   response.headers.<name>          → string (case-insensitive)
 *   response.content_type            → string
 *   operation.method                 → string (UPPER)
 *   operation.path                   → string (verbatim from spec)
 *   operation.path_regex             → string (matched against operation.path)
 *   finding.check                    → string
 *   finding.recommended_action       → string
 *   finding.message                  → string
 *   evidence.<deep.path>             → any (dot-traverses finding.evidence)
 *
 * Operators (per ConditionValue in config.ts):
 *   scalar literal       → equals
 *   { present: true }    → field is defined and non-null
 *   { absent: true }     → field is undefined or null
 *   { equals: <scalar> } → strict ==, with number/string coercion for response.status
 *   { contains: <str> }  → substring on the string value
 *   { matches: <regex> } → RegExp test on string value
 *   { in: [...] }        → value ∈ array
 *
 * Out of scope (Phase B/C territory): expression eval, OR semantics
 * across conditions (use multiple suppressions instead), wildcards.
 */

import type { ConditionMap, ConditionValue } from "./config.ts";

/** What the matcher sees. Built in calibrator.ts from a finding plus
 *  the response details the producer threads through. */
export interface MatchContext {
  finding: {
    check: string;
    recommended_action?: string;
    message?: string;
    evidence?: Record<string, unknown>;
  };
  operation: {
    method: string;
    path: string;
    operationId?: string;
  };
  response: {
    status: number;
    /** Case-insensitive accessor; pass headers in any case — matcher
     *  lowercases the lookup key. */
    headers: Record<string, string>;
    content_type?: string;
  };
}

/** Evaluate every condition; AND-combine. Empty map returns true
 *  (caller is expected to reject empty `when:` at validation time). */
export function matchesAll(conds: ConditionMap, ctx: MatchContext): boolean {
  for (const [path, cond] of Object.entries(conds)) {
    if (!matchOne(path, cond, ctx)) return false;
  }
  return true;
}

function matchOne(path: string, cond: ConditionValue, ctx: MatchContext): boolean {
  const value = resolvePath(path, ctx);

  // Shorthand: scalar → equals
  if (typeof cond === "string" || typeof cond === "number" || typeof cond === "boolean") {
    return coerceEquals(value, cond);
  }
  if (cond === null || typeof cond !== "object") return false;

  if ("present" in cond) return value !== undefined && value !== null;
  if ("absent" in cond) return value === undefined || value === null;
  if ("equals" in cond) return coerceEquals(value, cond.equals);
  if ("contains" in cond) return typeof value === "string" && value.includes(cond.contains);
  if ("matches" in cond) {
    if (typeof value !== "string") return false;
    try {
      return new RegExp(cond.matches).test(value);
    } catch {
      return false; // regex failed to compile — validation should have caught
    }
  }
  if ("in" in cond) {
    if (!Array.isArray(cond.in)) return false;
    return cond.in.some((item) => coerceEquals(value, item));
  }
  return false;
}

/** Coerce numbers ↔ strings for status-like fields where YAML
 *  ambiguity is common (`response.status: 400` vs `"400"`). Strict
 *  for other types. */
function coerceEquals(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (typeof actual === "number" && typeof expected === "string") {
    return String(actual) === expected;
  }
  if (typeof actual === "string" && typeof expected === "number") {
    return actual === String(expected);
  }
  return false;
}

/**
 * Resolve a dot-path against the context. Returns `undefined` for
 * missing paths (callers treat as "no value" for `absent:`/`equals:`).
 *
 * Special cases:
 *   - `response.headers.X-Foo` lowercases the header name (HTTP
 *     headers are case-insensitive; configs author them how they
 *     please).
 *   - `operation.path_regex` resolves to `operation.path` (so the
 *     `matches:` operator works naturally — `{path_regex: {matches: ...}}`).
 *   - `evidence.<deep.path>` walks `finding.evidence` recursively.
 *     Arrays are not traversed (Phase A keeps it simple).
 */
function resolvePath(path: string, ctx: MatchContext): unknown {
  if (path === "operation.path_regex") return ctx.operation.path;

  if (path.startsWith("response.headers.")) {
    const hname = path.slice("response.headers.".length).toLowerCase();
    for (const [k, v] of Object.entries(ctx.response.headers)) {
      if (k.toLowerCase() === hname) return v;
    }
    return undefined;
  }

  if (path.startsWith("evidence.")) {
    const rest = path.slice("evidence.".length);
    return walkDotPath(ctx.finding.evidence, rest);
  }

  // Top-level domain dispatch
  const [head, ...rest] = path.split(".");
  let root: unknown;
  switch (head) {
    case "response": root = ctx.response; break;
    case "operation": root = ctx.operation; break;
    case "finding": root = ctx.finding; break;
    default: return undefined;
  }
  return walkDotPath(root, rest.join("."));
}

function walkDotPath(root: unknown, dotPath: string): unknown {
  if (!dotPath) return root;
  let cur: unknown = root;
  for (const seg of dotPath.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
