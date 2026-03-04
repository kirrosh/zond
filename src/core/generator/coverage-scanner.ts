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
            const path = trimmed.slice(trimmed.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
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
export function normalizePath(path: string): string {
  return path
    .replace(/\{\{[^}]+\}\}/g, "{*}")  // {{var}} → {*}
    .replace(/\{[^}]+\}/g, "{*}")       // {id} → {*}
    .replace(/\/+$/, "");
}

/**
 * Convert a spec path to a regex that matches both parameterized and concrete paths.
 * e.g. /pet/{petId} matches /pet/100001 and /pet/{{pet_id}}
 */
export function specPathToRegex(specPath: string): RegExp {
  const pattern = specPath
    .split("/")
    .map((seg) =>
      /^\{[^}]+\}$/.test(seg)
        ? "[^/]+"
        : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${pattern}$`);
}

/**
 * Filter endpoints that don't yet have test coverage.
 */
export function filterUncoveredEndpoints(
  all: EndpointInfo[],
  covered: CoveredEndpoint[],
): EndpointInfo[] {
  return all.filter((ep) => {
    const specRegex = specPathToRegex(ep.path);
    return !covered.some(
      (c) => c.method === ep.method && specRegex.test(normalizePath(c.path)),
    );
  });
}
