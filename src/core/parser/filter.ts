import type { TestSuite } from "./types.ts";
import { compileOperationFilter } from "../utils/operation-filter.ts";
import type { EndpointInfo } from "../generator/types.ts";

/**
 * Filter suites by tags (OR logic, case-insensitive).
 * Suites without tags are excluded when filtering is active.
 */
export function filterSuitesByTags(suites: TestSuite[], tags: string[]): TestSuite[] {
  if (tags.length === 0) return suites;
  const normalizedTags = tags.map(t => t.toLowerCase());
  return suites.filter(suite => {
    if (!suite.tags || suite.tags.length === 0) return false;
    return suite.tags.some(t => normalizedTags.includes(t.toLowerCase()));
  });
}

/**
 * Exclude suites whose tags intersect with the exclusion set (OR logic, case-insensitive).
 * Suites without tags are kept.
 */
export function excludeSuitesByTags(suites: TestSuite[], excludeTags: string[]): TestSuite[] {
  if (excludeTags.length === 0) return suites;
  const normalizedTags = excludeTags.map(t => t.toLowerCase());
  return suites.filter(suite => {
    if (!suite.tags || suite.tags.length === 0) return true;
    return !suite.tags.some(t => normalizedTags.includes(t.toLowerCase()));
  });
}

/**
 * Filter test steps within suites by HTTP method (case-insensitive).
 * Suites with no remaining tests are removed.
 */
export function filterSuitesByMethod(suites: TestSuite[], method: string): TestSuite[] {
  const upperMethod = method.toUpperCase();
  const filtered = suites.map(suite => ({
    ...suite,
    tests: suite.tests.filter(t => (t.method ?? "GET").toUpperCase() === upperMethod),
  }));
  return filtered.filter(s => s.tests.length > 0);
}

export interface SuiteFilterResult {
  suites: TestSuite[];
  errors: string[];
}

/**
 * ARV-25: parity with `zond generate`/`zond checks run` — apply the unified
 * `--include`/`--exclude` selector grammar (path/method/tag/operation-id)
 * to a list of test suites. Step-level selectors (path, method, operation-id)
 * filter steps within a suite; suite-level selectors (tag) borrow each
 * step's parent suite tags. A suite drops out once it has no steps left.
 *
 * Reuses `compileOperationFilter` so semantics match generate/checks 1:1
 * (multiple --include combine with OR; --exclude evaluated after includes).
 *
 * `operation-id` matches against `step.source?.endpoint` ("METHOD /path"),
 * which is what the generator records; tests authored manually without
 * `source.endpoint` simply never match operation-id selectors.
 */
export function filterSuitesByOperationFilter(
  suites: TestSuite[],
  includes: string[],
  excludes: string[],
): SuiteFilterResult {
  if (includes.length === 0 && excludes.length === 0) {
    return { suites, errors: [] };
  }
  const compiled = compileOperationFilter({ includes, excludes });
  if (compiled.errors.length > 0) {
    return { suites: [], errors: compiled.errors };
  }
  const filtered = suites.map(suite => ({
    ...suite,
    tests: suite.tests.filter(step => compiled.filter(stepToEndpoint(suite, step))),
  }));
  return { suites: filtered.filter(s => s.tests.length > 0), errors: [] };
}

function stepToEndpoint(suite: TestSuite, step: TestSuite["tests"][number]): EndpointInfo {
  const sourceEndpoint = typeof step.source?.endpoint === "string" ? step.source.endpoint : undefined;
  return {
    path: step.path,
    method: step.method,
    operationId: sourceEndpoint,
    summary: undefined,
    tags: suite.tags ?? [],
    parameters: [],
    requestBodySchema: undefined,
    requestBodyContentType: undefined,
    responseContentTypes: [],
    responses: [],
    security: [],
  };
}
