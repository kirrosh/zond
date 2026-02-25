import type { TestRunResult } from "../runner/types.ts";

export interface ReporterOptions {
  /** Whether to use ANSI colors. Default: auto-detect via isTTY. */
  color?: boolean;
}

export type ReporterName = "console" | "json";

export interface Reporter {
  report(results: TestRunResult[], options?: ReporterOptions): void;
}
