/**
 * ARV-116 (m-19): public surface of the output-spec module.
 */
export type {
  OutputChannel,
  OutputFormat,
  OutputOptions,
  OutputSpec,
  FormatPolicy,
  ResolvedOutput,
} from "./types.ts";
export { OutputSpecError } from "./types.ts";
export { resolveOutput, runCommandWithOutput, type RunOutputResult } from "./run.ts";
