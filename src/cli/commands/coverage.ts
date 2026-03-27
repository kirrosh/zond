import { readOpenApiSpec, extractEndpoints, scanCoveredEndpoints, filterUncoveredEndpoints, normalizePath, specPathToRegex, analyzeEndpoints } from "../../core/generator/index.ts";
import { getDb } from "../../db/schema.ts";
import { getResultsByRunId, getRunById } from "../../db/queries.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface CoverageOptions {
  spec: string;
  tests: string;
  failOnCoverage?: number;
  runId?: number;
  json?: boolean;
}

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";

function useColor(): boolean {
  return process.stdout.isTTY ?? false;
}

function extractPathFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return url.startsWith("/") ? url : null;
  }
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

    // Enriched mode with run results
    let passing = 0;
    let apiError = 0;
    let testFailed = 0;

    if (options.runId != null) {
      getDb();
      const run = getRunById(options.runId);
      if (!run) {
        printError(`Run #${options.runId} not found`);
        return 2;
      }

      const results = getResultsByRunId(options.runId);

      // Build endpoint → status map
      const endpointStatus = new Map<string, "passing" | "api_error" | "test_failed">();
      for (const r of results) {
        if (!r.request_url || !r.request_method) continue;
        const urlPath = extractPathFromUrl(r.request_url);
        if (!urlPath) continue;
        const normalizedUrl = normalizePath(urlPath);

        for (const ep of allEndpoints) {
          const regex = specPathToRegex(ep.path);
          if (r.request_method === ep.method && regex.test(normalizedUrl)) {
            const key = `${ep.method} ${ep.path}`;
            const existing = endpointStatus.get(key);

            if (r.response_status !== null && r.response_status >= 500) {
              endpointStatus.set(key, "api_error");
            } else if (r.status === "fail" || r.status === "error") {
              if (existing !== "api_error") {
                endpointStatus.set(key, "test_failed");
              }
            } else if (!existing) {
              endpointStatus.set(key, "passing");
            }
            break;
          }
        }
      }

      for (const status of endpointStatus.values()) {
        if (status === "passing") passing++;
        else if (status === "api_error") apiError++;
        else if (status === "test_failed") testFailed++;
      }
    }

    if (!options.json) {
      if (options.runId != null) {
        console.log(`Coverage: ${coveredCount}/${allEndpoints.length} endpoints (${percentage}%) — Run #${options.runId}`);
        console.log("");

        if (passing > 0) {
          console.log(`  ${color ? GREEN : ""}✅ ${passing} covered and passing${color ? RESET : ""}`);
        }
        if (apiError > 0) {
          console.log(`  ${color ? YELLOW : ""}⚠️  ${apiError} covered but returning 5xx (possibly broken API)${color ? RESET : ""}`);
        }
        if (testFailed > 0) {
          console.log(`  ${color ? RED : ""}❌ ${testFailed} covered, test assertions failed${color ? RESET : ""}`);
        }
        if (uncovered.length > 0) {
          console.log(`  ${color ? DIM : ""}⬜ ${uncovered.length} not covered${color ? RESET : ""}`);
        }
      } else {
        // Standard mode
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
      }

      // Static warnings (always shown in human-readable mode)
      const warnings = analyzeEndpoints(allEndpoints);
      if (warnings.length > 0) {
        console.log("");
        console.log(`${color ? YELLOW : ""}Spec warnings:${color ? RESET : ""}`);
        for (const w of warnings) {
          console.log(`  ${color ? YELLOW : ""}⚠${color ? RESET : ""} ${w.method.padEnd(7)} ${w.path}: ${w.warnings.join(", ")}`);
        }
      }
    }

    if (options.json) {
      const coveredEndpoints = allEndpoints.filter(ep => !uncovered.includes(ep)).map(ep => `${ep.method} ${ep.path}`);
      const uncoveredEndpoints = uncovered.map(ep => `${ep.method} ${ep.path}`);
      printJson(jsonOk("coverage", {
        covered: coveredCount,
        uncovered: uncovered.length,
        total: allEndpoints.length,
        percentage,
        coveredEndpoints,
        uncoveredEndpoints,
      }));
    }

    if (options.failOnCoverage !== undefined) {
      return percentage < options.failOnCoverage ? 1 : 0;
    }
    return uncovered.length > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("coverage", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
