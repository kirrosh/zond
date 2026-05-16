/**
 * Public entry point for the `core/checks` framework.
 *
 * Importing this module also triggers `checks/index.ts` which registers
 * the built-in checks exactly once.
 */
export type {
  Check,
  CheckCase,
  CheckContext,
  CheckFinding,
  CheckOutcome,
  CheckResponse,
  CheckRunData,
  CheckRunSummary,
  Phase,
  Severity,
} from "./types.ts";
export { emptySummary } from "./types.ts";
export {
  __resetRegistryForTests,
  getCheck,
  listChecks,
  registerCheck,
  selectChecks,
  type SelectOptions,
  type SelectionResult,
} from "./registry.ts";
export { runChecks, type RunChecksOptions, type RunChecksResult } from "./runner.ts";
export { registerBuiltinChecks } from "./checks/index.ts";
