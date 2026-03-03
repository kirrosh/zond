import { readOpenApiSpec, extractEndpoints, scanCoveredEndpoints, filterUncoveredEndpoints } from "../../core/generator/index.ts";
import { printError, printSuccess } from "../output.ts";

export interface CoverageOptions {
  spec: string;
  tests: string;
  failOnCoverage?: number;
}

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

function useColor(): boolean {
  return process.stdout.isTTY ?? false;
}

export async function coverageCommand(options: CoverageOptions): Promise<number> {
  const { spec, tests } = options;

  try {
    const doc = await readOpenApiSpec(spec);
    const allEndpoints = extractEndpoints(doc);

    if (allEndpoints.length === 0) {
      printError("No endpoints found in the OpenAPI spec");
      return 1;
    }

    const covered = await scanCoveredEndpoints(tests);
    const uncovered = filterUncoveredEndpoints(allEndpoints, covered);
    const coveredCount = allEndpoints.length - uncovered.length;
    const percentage = Math.round((coveredCount / allEndpoints.length) * 100);

    const color = useColor();

    // Summary
    console.log(`Coverage: ${coveredCount}/${allEndpoints.length} endpoints (${percentage}%)`);
    console.log("");

    // Covered endpoints
    if (coveredCount > 0) {
      console.log(`${color ? GREEN : ""}Covered:${color ? RESET : ""}`);
      for (const ep of allEndpoints) {
        if (!uncovered.includes(ep)) {
          console.log(`  ${color ? GREEN : ""}✓${color ? RESET : ""} ${ep.method.padEnd(7)} ${ep.path}`);
        }
      }
      console.log("");
    }

    // Uncovered endpoints
    if (uncovered.length > 0) {
      console.log(`${color ? RED : ""}Uncovered:${color ? RESET : ""}`);
      for (const ep of uncovered) {
        console.log(`  ${color ? RED : ""}✗${color ? RESET : ""} ${ep.method.padEnd(7)} ${ep.path}`);
      }
    }

    if (options.failOnCoverage !== undefined) {
      return percentage < options.failOnCoverage ? 1 : 0;
    }
    return uncovered.length > 0 ? 1 : 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
