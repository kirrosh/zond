import type { TestRunResult } from "../runner/types.ts";
import type { Reporter, ReporterOptions } from "./types.ts";
import { type Exporter, runExporter } from "../exporter/exporter.ts";

const jsonExporter: Exporter<TestRunResult[]> = {
  name: "json",
  mime: "application/json",
  render(results: TestRunResult[]): string {
    return JSON.stringify(results, null, 2);
  },
};

/** TASK-186: pure render → sanitizer pipeline; redaction lives in runExporter. */
export function generateJsonReport(results: TestRunResult[]): string {
  return runExporter(jsonExporter, results);
}

export const jsonReporter: Reporter = {
  report(results: TestRunResult[], _options?: ReporterOptions): void {
    console.log(generateJsonReport(results));
  },
};
