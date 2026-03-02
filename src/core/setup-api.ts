import { resolve, join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { getDb } from "../db/schema.ts";
import { createCollection, upsertEnvironment, findCollectionByNameOrId, normalizePath } from "../db/queries.ts";
import { readOpenApiSpec, extractEndpoints } from "./generator/index.ts";
import { toYaml } from "../cli/commands/envs.ts";

export interface SetupApiOptions {
  name: string;
  spec?: string;
  dir?: string;
  envVars?: Record<string, string>;
  dbPath?: string;
}

export interface SetupApiResult {
  created: true;
  collectionId: number;
  testPath: string;
  baseUrl: string;
  specEndpoints: number;
}

export async function setupApi(options: SetupApiOptions): Promise<SetupApiResult> {
  const { name, spec, dbPath } = options;

  getDb(dbPath);

  // Validate name uniqueness
  const existing = findCollectionByNameOrId(name);
  if (existing) {
    throw new Error(`API '${name}' already exists (id=${existing.id})`);
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
  let endpointCount = 0;
  if (spec) {
    const doc = await readOpenApiSpec(spec);
    openapiSpec = spec;
    if ((doc as any).servers?.[0]?.url) {
      baseUrl = (doc as any).servers[0].url;
    }
    endpointCount = extractEndpoints(doc).length;
  }

  // Build environment variables
  const envVars: Record<string, string> = {};
  if (baseUrl) envVars.base_url = baseUrl;
  if (options.envVars) {
    Object.assign(envVars, options.envVars);
  }

  // Write .env.yaml in base_dir
  if (Object.keys(envVars).length > 0) {
    const envFilePath = join(baseDir, ".env.yaml");
    writeFileSync(envFilePath, toYaml(envVars) + "\n", "utf-8");
  }

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

  return {
    created: true,
    collectionId,
    testPath: normalizedTestPath,
    baseUrl,
    specEndpoints: endpointCount,
  };
}
