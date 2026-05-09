import type { TestRunResult } from "../runner/types.ts";

export interface ReporterOptions {
  /** Whether to use ANSI colors. Default: auto-detect via isTTY. */
  color?: boolean;
  /** TASK-265: suppress per-suite/per-test detail and emit only the
   *  grand-total summary line. Exit code still carries pass/fail. */
  quiet?: boolean;
}

export type ReporterName = "console" | "json" | "junit";

export interface Reporter {
  report(results: TestRunResult[], options?: ReporterOptions): void;
}
