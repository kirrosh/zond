import { parse } from "../../core/parser/yaml-parser.ts";
import { printError, printSuccess } from "../output.ts";

export interface ValidateOptions {
  path: string;
}

export async function validateCommand(options: ValidateOptions): Promise<number> {
  try {
    const suites = await parse(options.path);
    const totalSteps = suites.reduce((sum, s) => sum + s.tests.length, 0);
    printSuccess(`OK: ${suites.length} suite(s), ${totalSteps} test(s) validated successfully`);
    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
