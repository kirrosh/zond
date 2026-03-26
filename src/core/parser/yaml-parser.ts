import { Glob } from "bun";
import { resolve } from "node:path";
import { validateSuite } from "./schema.ts";
import type { TestSuite } from "./types.ts";

export async function parseFile(filePath: string): Promise<TestSuite> {
  let text: string;
  try {
    text = await Bun.file(filePath).text();
  } catch (err) {
    throw new Error(`Failed to read file ${filePath}: ${(err as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = Bun.YAML.parse(text);
  } catch (err) {
    throw new Error(`Invalid YAML in ${filePath}: ${(err as Error).message}`);
  }

  try {
    const suite = validateSuite(raw);
    suite.filePath = resolve(filePath);
    return suite;
  } catch (err) {
    throw new Error(`Validation error in ${filePath}: ${(err as Error).message}`);
  }
}

export async function parseDirectory(dirPath: string): Promise<TestSuite[]> {
  const glob = new Glob("**/*.{yaml,yml}");
  const suites: TestSuite[] = [];

  for await (const file of glob.scan({ cwd: dirPath, absolute: false })) {
    // Skip environment files
    if (file.match(/\.env(\..+)?\.yaml$/) || file.match(/\.env(\..+)?\.yml$/)) {
      continue;
    }
    const fullPath = `${dirPath}/${file}`;
    try {
      suites.push(await parseFile(fullPath));
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

export async function parseDirectorySafe(dirPath: string): Promise<ParseDirectoryResult> {
  const glob = new Glob("**/*.{yaml,yml}");
  const suites: TestSuite[] = [];
  const errors: { file: string; error: string }[] = [];

  for await (const file of glob.scan({ cwd: dirPath, absolute: false })) {
    if (file.match(/\.env(\..+)?\.yaml$/) || file.match(/\.env(\..+)?\.yml$/)) {
      continue;
    }
    const fullPath = `${dirPath}/${file}`;
    try {
      suites.push(await parseFile(fullPath));
    } catch (err) {
      errors.push({ file, error: (err as Error).message });
    }
  }

  return { suites, errors };
}

export async function parse(path: string): Promise<TestSuite[]> {
  const file = Bun.file(path);
  const exists = await file.exists();

  if (exists) {
    return [await parseFile(path)];
  }

  // Not a file, try as directory
  return parseDirectory(path);
}
