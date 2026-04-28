import type { TestRunResult } from "../runner/types.ts";
import type { Reporter, ReporterOptions } from "./types.ts";

export function generateJsonReport(results: TestRunResult[]): string {
  return JSON.stringify(results, null, 2);
}

export const jsonReporter: Reporter = {
  report(results: TestRunResult[], _options?: ReporterOptions): void {
    console.log(generateJsonReport(results));
  },
};
