import { join } from "path";
import { createHash } from "crypto";
import type { ZondMeta, FileMeta } from "./types.ts";
import type { RawSuite } from "../generator/serializer.ts";
import { normalizePath } from "../generator/coverage-scanner.ts";

const META_FILENAME = ".zond-meta.json";

export async function readMeta(testsDir: string): Promise<ZondMeta | null> {
  const metaPath = join(testsDir, META_FILENAME);
  const file = Bun.file(metaPath);
  if (!(await file.exists())) return null;
  try {
    return JSON.parse(await file.text()) as ZondMeta;
  } catch {
    return null;
  }
}

export async function writeMeta(testsDir: string, meta: ZondMeta): Promise<void> {
  const metaPath = join(testsDir, META_FILENAME);
  await Bun.write(metaPath, JSON.stringify(meta, null, 2) + "\n");
}

export function hashSpec(specContent: string): string {
  return createHash("sha256").update(specContent).digest("hex");
}

/**
 * Derive suite type from tags array or filename.
 */
function detectSuiteType(suite: RawSuite): FileMeta["suiteType"] {
  const tags = suite.tags ?? [];
  if (tags.includes("auth")) return "auth";
  if (tags.includes("sanity")) return "sanity";
  if (tags.includes("crud")) return "crud";
  if (tags.includes("unsafe")) return "unsafe";
  return "smoke";
}

/**
 * Extract first tag from fileStem or suite folder for grouping.
 * e.g. fileStem "smoke-users" → tag "users"
 */
function detectTag(suite: RawSuite): string | undefined {
  const stem = suite.fileStem ?? suite.name;
  const match = stem.match(/^(?:smoke|crud|auth|sanity|unsafe)-(.+?)(?:-unsafe)?$/);
  return match?.[1];
}

/**
 * Build normalized endpoint keys from a raw suite's test steps.
 * e.g. "GET /users/{*}", "POST /users"
 */
function extractEndpointKeys(suite: RawSuite): string[] {
  const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const keys: string[] = [];
  for (const step of suite.tests) {
    for (const method of HTTP_METHODS) {
      const path = step[method] as string | undefined;
      if (path) {
        keys.push(`${method} ${normalizePath(path)}`);
        break;
      }
    }
  }
  return [...new Set(keys)];
}

export function buildFileMeta(suite: RawSuite, zondVersion: string): FileMeta {
  return {
    generatedAt: new Date().toISOString(),
    zondVersion,
    suiteType: detectSuiteType(suite),
    tag: detectTag(suite),
    endpoints: extractEndpointKeys(suite),
  };
}
