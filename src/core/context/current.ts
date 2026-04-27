import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILENAME = ".zond-current";

export function currentApiPath(cwd?: string): string {
  return join(cwd ?? process.cwd(), FILENAME);
}

/** Returns the API collection name stored in `.zond-current`, or null when the file is absent or empty. */
export function readCurrentApi(cwd?: string): string | null {
  const path = currentApiPath(cwd);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8").trim();
  return raw.length > 0 ? raw : null;
}

/** Writes the API collection name to `.zond-current`. The file is single-line plain text. */
export function writeCurrentApi(name: string, cwd?: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("API name cannot be empty");
  const path = currentApiPath(cwd);
  writeFileSync(path, trimmed + "\n", "utf-8");
  return path;
}

/** Deletes `.zond-current`. Returns true when a file was removed, false when it did not exist. */
export function clearCurrentApi(cwd?: string): boolean {
  const path = currentApiPath(cwd);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
