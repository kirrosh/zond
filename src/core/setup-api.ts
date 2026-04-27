import { resolve, join } from "path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { getDb } from "../db/schema.ts";
import { createCollection, deleteCollection, findCollectionByNameOrId, normalizePath } from "../db/queries.ts";
import { readOpenApiSpec, extractEndpoints } from "./generator/index.ts";
import { findWorkspaceRoot } from "./workspace/root.ts";

function toYaml(vars: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    const needsQuote = /[:#\[\]{}&*!|>'"@`,%]/.test(v) || v.includes(" ") || v === "";
    lines.push(`${k}: ${needsQuote ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v}`);
  }
  return lines.join("\n");
}

export interface SetupApiOptions {
  name?: string;
  spec?: string;
  dir?: string;
  envVars?: Record<string, string>;
  dbPath?: string;
  force?: boolean;
  insecure?: boolean;
}

export interface SetupApiResult {
  created: true;
  collectionId: number;
  baseDir: string;
  testPath: string;
  baseUrl: string;
  specEndpoints: number;
  pathParams?: Record<string, string>;
  warnings?: string[];
}

export async function setupApi(options: SetupApiOptions): Promise<SetupApiResult> {
  const { spec, dbPath } = options;

  getDb(dbPath);

  // Try to load and validate spec, extract base_url
  let openapiSpec: string | null = null;
  let baseUrl = "";
  let endpointCount = 0;
  const pathParams = new Map<string, string>();
  const warnings: string[] = [];
  let specTitle: string | undefined;
  if (spec) {
    const doc = await readOpenApiSpec(spec, { insecure: options.insecure });
    openapiSpec = spec;
    if ((doc as any).servers?.[0]?.url) {
      baseUrl = (doc as any).servers[0].url;
    }
    if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      warnings.push(`Spec server URL "${baseUrl}" is relative — requests will fail without a host. Override with envVars: {"base_url": "https://your-host${baseUrl}"}`);
    }
    specTitle = (doc as any).info?.title;
    const endpoints = extractEndpoints(doc);
    endpointCount = endpoints.length;

    // Collect unique path parameters with default values
    for (const ep of endpoints) {
      for (const param of (ep.parameters ?? []).filter(p => p.in === "path")) {
        if (pathParams.has(param.name)) continue;
        const schema = param.schema as any;
        if (param.example !== undefined) pathParams.set(param.name, String(param.example));
        else if (schema?.example !== undefined) pathParams.set(param.name, String(schema.example));
        else if (schema?.type === "integer" || schema?.type === "number") pathParams.set(param.name, "1");
        else pathParams.set(param.name, "example");
      }
    }
  }

  // Derive name: explicit > spec title > filename
  const name = options.name
    ?? specTitle?.replace(/[^a-zA-Z0-9_\-\.]/g, "-").toLowerCase()
    ?? spec?.split(/[/\\]/).pop()?.replace(/\.\w+$/, "")
    ?? "api";

  // Validate name uniqueness (or force-replace)
  const existing = findCollectionByNameOrId(name);
  if (existing) {
    if (options.force) {
      deleteCollection(existing.id, true);
    } else {
      throw new Error(`API '${name}' already exists (id=${existing.id})`);
    }
  }

  // Sanitize name for directory use
  const dirName = name.replace(/[^a-zA-Z0-9_\-\.]/g, "-").toLowerCase();
  const baseDir = options.dir
    ? resolve(options.dir)
    : resolve(findWorkspaceRoot().root, `apis/${dirName}/`);
  const testPath = join(baseDir, "tests");

  // Create directories
  mkdirSync(testPath, { recursive: true });

  // Build environment variables
  const envVars: Record<string, string> = {};
  if (baseUrl) envVars.base_url = baseUrl;
  // Add path parameter defaults (before user overrides)
  for (const [k, v] of pathParams) {
    if (!(k in envVars)) envVars[k] = v;
  }
  if (options.envVars) {
    Object.assign(envVars, options.envVars);
  }

  // Write .env.yaml in base_dir
  if (Object.keys(envVars).length > 0) {
    const envFilePath = join(baseDir, ".env.yaml");
    writeFileSync(envFilePath, toYaml(envVars) + "\n", "utf-8");
  }

  // Create/update .gitignore to exclude env files
  const gitignorePath = join(baseDir, ".gitignore");
  const gitignoreContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  if (!gitignoreContent.includes(".env*.yaml")) {
    writeFileSync(
      gitignorePath,
      gitignoreContent + (gitignoreContent.endsWith("\n") || !gitignoreContent ? "" : "\n") + ".env*.yaml\n",
      "utf-8",
    );
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

  const pathParamsObj = pathParams.size > 0 ? Object.fromEntries(pathParams) : undefined;

  return {
    created: true,
    collectionId,
    baseDir: normalizedBaseDir,
    testPath: normalizedTestPath,
    baseUrl,
    specEndpoints: endpointCount,
    ...(pathParamsObj ? { pathParams: pathParamsObj } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
