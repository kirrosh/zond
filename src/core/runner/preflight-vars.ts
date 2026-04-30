import type { TestSuite, TestStep, AssertionRule } from "../parser/types.ts";
import { GENERATORS } from "../parser/variables.ts";

const VAR_PATTERN = /\{\{([^{}]+)\}\}/g;

function scanRefs(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(VAR_PATTERN)) {
      const key = match[1]!.trim();
      if (!key.startsWith("$")) out.add(key);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) scanRefs(item, out);
  } else if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) scanRefs(v, out);
  }
}

function collectCapturesAndSets(step: TestStep, out: Set<string>): void {
  if (step.set) {
    for (const k of Object.keys(step.set)) out.add(k);
  }
  if (step.for_each?.var) out.add(step.for_each.var);
  const scanRule = (rule: AssertionRule | undefined): void => {
    if (!rule) return;
    if (rule.capture) out.add(rule.capture);
    if (rule.each) {
      for (const r of Object.values(rule.each)) scanRule(r);
    }
    if (rule.contains_item) {
      for (const r of Object.values(rule.contains_item)) scanRule(r);
    }
  };
  if (step.expect?.body) {
    for (const r of Object.values(step.expect.body)) scanRule(r);
  }
  if (step.expect?.headers) {
    for (const v of Object.values(step.expect.headers)) {
      if (typeof v === "object" && v !== null) scanRule(v as AssertionRule);
    }
  }
}

export interface MissingVarHit {
  suite: string;
  file?: string;
  step?: string;
  variable: string;
}

/**
 * Pre-flight scan: find {{var}} references in suites that have no producer
 * (env value, suite-level parameterize/set, prior-step capture). Excludes
 * built-in $generators.
 *
 * Conservative: per-suite — accumulates all captures/sets across steps, so
 * forward references inside the suite are tolerated (correctness requires
 * runtime ordering checks anyway).
 */
export function preflightCheckVars(
  suites: TestSuite[],
  env: Record<string, string>,
): MissingVarHit[] {
  const hits: MissingVarHit[] = [];
  const generatorKeys = new Set(Object.keys(GENERATORS));

  for (const suite of suites) {
    const known = new Set<string>(Object.keys(env));
    if (suite.parameterize) {
      for (const k of Object.keys(suite.parameterize)) known.add(k);
    }
    for (const step of suite.tests) collectCapturesAndSets(step, known);

    const scanStepRefs = (step: TestStep): Set<string> => {
      const refs = new Set<string>();
      scanRefs(step.path, refs);
      scanRefs(step.headers, refs);
      scanRefs(step.json, refs);
      scanRefs(step.form, refs);
      scanRefs(step.multipart, refs);
      scanRefs(step.query, refs);
      if (step.skip_if) scanRefs(step.skip_if, refs);
      if (step.retry_until) scanRefs(step.retry_until.condition, refs);
      if (step.set) scanRefs(step.set, refs);
      if (step.for_each) scanRefs(step.for_each.in, refs);
      return refs;
    };

    const suiteRefs = new Set<string>();
    if (suite.base_url) scanRefs(suite.base_url, suiteRefs);
    if (suite.headers) scanRefs(suite.headers, suiteRefs);
    for (const v of suiteRefs) {
      if (!known.has(v) && !generatorKeys.has(v)) {
        hits.push({ suite: suite.name, file: suite.filePath, variable: v });
      }
    }

    for (const step of suite.tests) {
      const refs = scanStepRefs(step);
      for (const v of refs) {
        if (!known.has(v) && !generatorKeys.has(v)) {
          hits.push({
            suite: suite.name,
            file: suite.filePath,
            step: step.name,
            variable: v,
          });
        }
      }
    }
  }

  return hits;
}

export function formatMissingVarLine(hit: MissingVarHit): string {
  const where = hit.step ? `${hit.suite} → ${hit.step}` : hit.suite;
  const file = hit.file ? ` (${hit.file})` : "";
  return `Undefined variable {{${hit.variable}}} in ${where}${file}`;
}
