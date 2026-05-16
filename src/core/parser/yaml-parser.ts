import { Glob } from "bun";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { validateSuite, formatZodError } from "./schema.ts";
import type { TestSuite } from "./types.ts";

export interface ParseOptions {
  /** Surface raw `ZodError.message` (the JSON-formatted issue stack) instead
   * of the human-friendly summary. Useful for filing zod bugs / debugging the
   * schema itself; default output is human-readable. (TASK-249) */
  verbose?: boolean;
}

/** Convert a 0-based byte offset into a 1-based (line, col) position. */
function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

/**
 * Format a YAML parse error as `file:line:col: <reason>` plus a snippet with
 * a column pointer. Bun.YAML's SyntaxError exposes JS stack coordinates, not
 * YAML positions, so on parse failure we re-parse with eemeli/yaml (which
 * provides accurate `linePos`) just for diagnostics.
 *
 * Exported for tests.
 */
export function formatYamlParseError(filePath: string, text: string, primary: Error): Error {
  const doc = YAML.parseDocument(text);
  const e = doc.errors[0];
  if (e?.linePos?.[0]) {
    const { line, col } = e.linePos[0];
    // eemeli's message reads "<reason> at line X, column Y:\n\n<snippet>".
    // Strip the "at line ..." part since we surface line:col in the prefix.
    const cleaned = e.message.replace(/\s+at line \d+, column \d+:/, ":");
    return new Error(`Invalid YAML in ${filePath}:${line}:${col}: ${cleaned}`);
  }
  // eemeli accepted but Bun rejected — fall back to original message.
  return new Error(`Invalid YAML in ${filePath}: ${primary.message}`);
}

export async function parseFile(filePath: string, opts: ParseOptions = {}): Promise<TestSuite> {
  let text: string;
  try {
    text = await Bun.file(filePath).text();
  } catch (err) {
    throw new Error(`Failed to read file ${filePath}: ${(err as Error).message}`);
  }

  // Both Bun.YAML and eemeli/yaml accept NUL bytes silently, but they corrupt
  // downstream consumers (sqlite TEXT, JSON, terminals). Surface explicitly.
  const nulIdx = text.indexOf("\x00");
  if (nulIdx >= 0) {
    const { line, col } = offsetToLineCol(text, nulIdx);
    throw new Error(
      `Invalid YAML in ${filePath}:${line}:${col}: NUL byte (\\x00) in source — ` +
      `if you need a NUL in a request body, use the {{$nullByte}} generator instead of inlining the byte`
    );
  }

  let raw: unknown;
  try {
    raw = Bun.YAML.parse(text);
  } catch (err) {
    throw formatYamlParseError(filePath, text, err as Error);
  }

  try {
    const suite = validateSuite(raw);
    suite.filePath = resolve(filePath);
    return suite;
  } catch (err) {
    if (err instanceof z.ZodError && !opts.verbose) {
      throw new Error(`Validation error in ${filePath}:\n${formatZodError(err)}`);
    }
    throw new Error(`Validation error in ${filePath}: ${(err as Error).message}`);
  }
}

/**
 * Files that live alongside test suites but aren't suites themselves. The
 * yaml-parser scans recursively from the workspace root, so picking these up
 * would surface spurious "Validation error: missing field name" noise.
 */
function isNonSuiteYaml(file: string): boolean {
  if (file.match(/\.env(\..+)?\.ya?ml$/)) return true;
  // Workspace marker — present at the root of every zond workspace.
  if (file === "zond.config.yml" || file === "zond.config.yaml") return true;
  // Per-API artifact files written by `zond add api` / `zond refresh-api`.
  // Match the basename so it works for files at any depth (apis/<name>/...).
  const basename = file.split("/").pop() ?? file;
  if (/^\.api-[a-z0-9-]+\.ya?ml$/i.test(basename)) return true;
  return false;
}

export async function parseDirectory(dirPath: string, opts: ParseOptions = {}): Promise<TestSuite[]> {
  const glob = new Glob("**/*.{yaml,yml}");
  const suites: TestSuite[] = [];

  for await (const file of glob.scan({ cwd: dirPath, absolute: false })) {
    if (isNonSuiteYaml(file)) {
      continue;
    }
    const fullPath = `${dirPath}/${file}`;
    try {
      suites.push(await parseFile(fullPath, opts));
    } catch {
      // Skip files that fail to parse (e.g. invalid AI-generated YAML)
      // so one bad file doesn't block the entire directory
    }
  }

  return suites;
}

export interface ParseDirectoryResult {
  suites: TestSuite[];
  errors: { file: string; error: string }[];
}

export async function parseDirectorySafe(dirPath: string, opts: ParseOptions = {}): Promise<ParseDirectoryResult> {
  const glob = new Glob("**/*.{yaml,yml}");
  const suites: TestSuite[] = [];
  const errors: { file: string; error: string }[] = [];

  for await (const file of glob.scan({ cwd: dirPath, absolute: false })) {
    if (isNonSuiteYaml(file)) {
      continue;
    }
    const fullPath = `${dirPath}/${file}`;
    try {
      suites.push(await parseFile(fullPath, opts));
    } catch (err) {
      errors.push({ file, error: (err as Error).message });
    }
  }

  return { suites, errors };
}

export async function parse(path: string, opts: ParseOptions = {}): Promise<TestSuite[]> {
  const file = Bun.file(path);
  const exists = await file.exists();

  if (exists) {
    return [await parseFile(path, opts)];
  }

  // Not a file, try as directory
  return parseDirectory(path, opts);
}

/**
 * Like {@link parse}, but never silently drops files. Returns both successfully
 * parsed suites and per-file parse errors so callers (run, validate, tag-filter)
 * can surface failures instead of pretending the file did not exist.
 */
export async function parseSafe(path: string, opts: ParseOptions = {}): Promise<ParseDirectoryResult> {
  const file = Bun.file(path);
  const exists = await file.exists();

  if (exists) {
    try {
      return { suites: [await parseFile(path, opts)], errors: [] };
    } catch (err) {
      return { suites: [], errors: [{ file: path, error: (err as Error).message }] };
    }
  }

  return parseDirectorySafe(path, opts);
}
