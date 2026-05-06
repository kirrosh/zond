import type { TestRunResult } from "../runner/types.ts";
import type { Reporter, ReporterOptions } from "./types.ts";
import { redact } from "../secrets/registry.ts";

export function generateJsonReport(results: TestRunResult[]): string {
  // TASK-168 (m-10): redact registered secret values inside the
  // serialised payload. Done as a string-pass after JSON.stringify so
  // every nested string field is covered without per-key plumbing.
  return redact(JSON.stringify(results, null, 2));
}

export const jsonReporter: Reporter = {
  report(results: TestRunResult[], _options?: ReporterOptions): void {
    console.log(generateJsonReport(results));
  },
};
