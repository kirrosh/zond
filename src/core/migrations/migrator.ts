import { Glob } from "bun";
import { serializeSuite } from "../generator/serializer.ts";
import type { RawSuite } from "../generator/serializer.ts";
import type { Migration, MigrationResult } from "./types.ts";

/**
 * Parse a YAML test file into a RawSuite without strict validation.
 * Intentionally lenient so migrations can handle older/non-standard formats.
 */
async function parseYamlToRawSuite(filePath: string): Promise<RawSuite> {
  const text = await Bun.file(filePath).text();
  const raw = Bun.YAML.parse(text) as Record<string, unknown>;

  const tests = Array.isArray(raw["tests"])
    ? (raw["tests"] as Record<string, unknown>[]).map((step) => ({
        name: String(step["name"] ?? ""),
        ...step,
        expect: (step["expect"] as RawSuite["tests"][number]["expect"]) ?? {},
      }))
    : [];

  return {
    name: String(raw["name"] ?? ""),
    setup: raw["setup"] === true ? true : undefined,
    tags: Array.isArray(raw["tags"]) ? (raw["tags"] as string[]) : undefined,
    folder: raw["folder"] !== undefined ? String(raw["folder"]) : undefined,
    fileStem: raw["fileStem"] !== undefined ? String(raw["fileStem"]) : undefined,
    base_url: raw["base_url"] !== undefined ? String(raw["base_url"]) : undefined,
    headers:
      raw["headers"] && typeof raw["headers"] === "object" && !Array.isArray(raw["headers"])
        ? (raw["headers"] as Record<string, string>)
        : undefined,
    tests,
  };
}

/**
 * Apply a list of migrations to all YAML test files in a directory.
 * Files that need no changes are left untouched (original bytes preserved).
 */
export async function applyMigrationsToDirectory(
  testsDir: string,
  migrations: Migration[],
  dryRun: boolean,
): Promise<MigrationResult[]> {
  if (migrations.length === 0) return [];

  const results: MigrationResult[] = [];
  const glob = new Glob("*.yaml");

  for await (const fileName of glob.scan({ cwd: testsDir, absolute: false })) {
    // Skip environment files
    if (fileName.startsWith(".env")) continue;

    const filePath = `${testsDir}/${fileName}`;
    const result = await applyMigrationsToFile(filePath, fileName, migrations, dryRun);
    results.push(result);
  }

  return results;
}

async function applyMigrationsToFile(
  filePath: string,
  fileName: string,
  migrations: Migration[],
  dryRun: boolean,
): Promise<MigrationResult> {
  let suite: RawSuite;
  try {
    suite = await parseYamlToRawSuite(filePath);
  } catch (err) {
    return {
      file: fileName,
      changed: false,
      appliedMigrations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const applied: string[] = [];
  let current = suite;

  for (const migration of migrations) {
    const result = migration.transformSuite(current);
    if (result !== null) {
      current = result;
      applied.push(migration.toVersion);
    }
  }

  if (applied.length === 0) {
    return { file: fileName, changed: false, appliedMigrations: [] };
  }

  if (!dryRun) {
    const newYaml = serializeSuite(current);
    await Bun.write(filePath, newYaml);
  }

  return { file: fileName, changed: true, appliedMigrations: applied };
}
