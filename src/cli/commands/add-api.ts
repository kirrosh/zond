import { resolve, join } from "path";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import { getDb } from "../../db/schema.ts";
import { createCollection, upsertEnvironment, findCollectionByNameOrId } from "../../db/queries.ts";
import { normalizePath } from "../../db/queries.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import { printError, printSuccess } from "../output.ts";
import { toYaml } from "./envs.ts";

export interface AddApiOptions {
  name: string;
  spec?: string;
  dir?: string;
  envPairs?: string[];
  dbPath?: string;
}

export async function addApiCommand(options: AddApiOptions): Promise<number> {
  const { name, spec, envPairs, dbPath } = options;

  try {
    getDb(dbPath);
  } catch (err) {
    printError(`Failed to open database: ${(err as Error).message}`);
    return 2;
  }

  // Validate name uniqueness
  const existing = findCollectionByNameOrId(name);
  if (existing) {
    printError(`API '${name}' already exists (id=${existing.id})`);
    return 1;
  }

  // Sanitize name for directory use
  const dirName = name.replace(/[^a-zA-Z0-9_\-\.]/g, "-").toLowerCase();
  const baseDir = resolve(options.dir ?? `./apis/${dirName}/`);
  const testPath = join(baseDir, "tests");

  // Create directories
  mkdirSync(testPath, { recursive: true });

  // Try to load and validate spec, extract base_url
  let openapiSpec: string | null = null;
  let baseUrl = "";
  if (spec) {
    try {
      const doc = await readOpenApiSpec(spec);
      openapiSpec = spec;

      // Extract base_url from servers[0]
      if (doc.servers && doc.servers.length > 0) {
        baseUrl = doc.servers[0]!.url;
      }
    } catch (err) {
      printError(`Failed to read OpenAPI spec: ${(err as Error).message}`);
      return 1;
    }
  }

  // Build environment variables
  const envVars: Record<string, string> = {};
  if (baseUrl) envVars.base_url = baseUrl;

  // Parse --env key=value pairs
  if (envPairs) {
    for (const pair of envPairs) {
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key) envVars[key] = value;
    }
  }

  // Write .env.yaml in base_dir
  if (Object.keys(envVars).length > 0) {
    const envFilePath = join(baseDir, ".env.yaml");
    writeFileSync(envFilePath, toYaml(envVars) + "\n", "utf-8");
  }

  // If spec is a local file, copy/store relative or absolute path
  const normalizedTestPath = normalizePath(testPath);
  const normalizedBaseDir = normalizePath(baseDir);

  // Create collection in DB
  const collectionId = createCollection({
    name,
    base_dir: normalizedBaseDir,
    test_path: normalizedTestPath,
    openapi_spec: openapiSpec ?? undefined,
  });

  // Create a scoped "default" environment in DB
  if (Object.keys(envVars).length > 0) {
    upsertEnvironment("default", envVars, collectionId);
  }

  // Summary
  printSuccess(`API '${name}' created (id=${collectionId})`);
  console.log(`  Directory: ${baseDir}`);
  console.log(`  Tests:     ${testPath}/`);
  if (openapiSpec) console.log(`  Spec:      ${openapiSpec}`);
  if (baseUrl) console.log(`  Base URL:  ${baseUrl}`);
  console.log();
  console.log("Next steps:");
  console.log(`  apitool ai-generate --api ${name} --prompt "test the user endpoints"`);
  console.log(`  apitool run --api ${name}`);

  return 0;
}
