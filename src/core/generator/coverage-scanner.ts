import { Glob } from "bun";
import type { EndpointInfo } from "./types.ts";

export interface CoveredEndpoint {
  method: string;
  path: string;
  file: string;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Scan YAML test files in outputDir and extract method+path from each test step.
 * Uses simple regex to avoid importing the full parser.
 */
export async function scanCoveredEndpoints(outputDir: string): Promise<CoveredEndpoint[]> {
  const covered: CoveredEndpoint[] = [];

  const glob = new Glob("**/*.yaml");
  for await (const file of glob.scan({ cwd: outputDir, absolute: true })) {
    try {
      const content = await Bun.file(file).text();
      const lines = content.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        for (const method of HTTP_METHODS) {
          // Match lines like "POST: /users" or "GET: /users/{{user_id}}"
          if (trimmed.startsWith(`${method}:`) || trimmed.startsWith(`${method} :`)) {
            const path = trimmed.slice(trimmed.indexOf(":") + 1).trim();
            if (path) {
              covered.push({ method, path: normalizePath(path), file });
            }
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return covered;
}

/**
 * Normalize path for comparison:
 * - Replace {{variable}} with {*}
 * - Replace {paramName} with {*}
 * - Remove trailing slashes
 */
function normalizePath(path: string): string {
  return path
    .replace(/\{\{[^}]+\}\}/g, "{*}")  // {{var}} → {*}
    .replace(/\{[^}]+\}/g, "{*}")       // {id} → {*}
    .replace(/\/+$/, "");
}

/**
 * Filter endpoints that don't yet have test coverage.
 */
export function filterUncoveredEndpoints(
  all: EndpointInfo[],
  covered: CoveredEndpoint[],
): EndpointInfo[] {
  const coveredSet = new Set(
    covered.map((c) => `${c.method} ${c.path}`),
  );

  return all.filter((ep) => {
    const normalizedPath = normalizePath(ep.path);
    const key = `${ep.method} ${normalizedPath}`;
    return !coveredSet.has(key);
  });
}
