export type { Reporter, ReporterOptions, ReporterName } from "./types.ts";
export { consoleReporter, formatDuration, formatStep, formatFailures, formatSuiteResult, formatGrandTotal } from "./console.ts";
export { jsonReporter } from "./json.ts";

import type { Reporter, ReporterName } from "./types.ts";
import { consoleReporter } from "./console.ts";
import { jsonReporter } from "./json.ts";

const reporters: Record<ReporterName, Reporter> = {
  console: consoleReporter,
  json: jsonReporter,
};

export function getReporter(name: ReporterName): Reporter {
  const reporter = reporters[name];
  if (!reporter) {
    throw new Error(`Unknown reporter: ${name}. Available: ${Object.keys(reporters).join(", ")}`);
  }
  return reporter;
}
