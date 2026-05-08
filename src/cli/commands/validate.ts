import { parse } from "../../core/parser/yaml-parser.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface ValidateOptions {
  path: string;
  json?: boolean;
  verbose?: boolean;
}

export async function validateCommand(options: ValidateOptions): Promise<number> {
  try {
    const suites = await parse(options.path, { verbose: options.verbose });
    const totalSteps = suites.reduce((sum, s) => sum + s.tests.length, 0);
    if (options.json) {
      printJson(jsonOk("validate", {
        files: suites.length,
        suites: suites.length,
        tests: totalSteps,
        valid: true,
      }));
    } else {
      printSuccess(`OK: ${suites.length} suite(s), ${totalSteps} test(s) validated successfully`);
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("validate", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}

import type { Command } from "commander";
import { globalJson } from "../resolve.ts";

export function registerValidate(program: Command): void {
  program
    .command("validate <path>")
    .description("Validate test files without running")
    .option("--verbose", "Show full zod issue stack instead of human-friendly summary")
    .action(async (path: string, opts: { verbose?: boolean }, cmd: Command) => {
      process.exitCode = await validateCommand({
        path,
        json: globalJson(cmd),
        verbose: opts.verbose === true,
      });
    });
}
