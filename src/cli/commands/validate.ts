import { parse } from "../../core/parser/yaml-parser.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface ValidateOptions {
  path: string;
  json?: boolean;
}

export async function validateCommand(options: ValidateOptions): Promise<number> {
  try {
    const suites = await parse(options.path);
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
