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
