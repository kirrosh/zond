import { Glob } from "bun";
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
    return validateSuite(raw);
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
    suites.push(await parseFile(fullPath));
  }

  return suites;
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
