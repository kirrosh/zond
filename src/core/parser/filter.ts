import type { TestSuite } from "./types.ts";

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
