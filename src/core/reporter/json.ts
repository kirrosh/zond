import type { TestRunResult } from "../runner/types.ts";
import type { Reporter, ReporterOptions } from "./types.ts";

export const jsonReporter: Reporter = {
  report(results: TestRunResult[], _options?: ReporterOptions): void {
    const json = JSON.stringify(results, null, 2);
    console.log(json);
  },
};
