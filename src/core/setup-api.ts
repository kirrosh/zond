import { resolve, join, relative } from "path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { getDb } from "../db/schema.ts";
import { createCollection, deleteCollection, findCollectionByNameOrId, normalizePath } from "../db/queries.ts";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  buildCatalog,
  serializeCatalog,
  buildApiResourceMap,
  serializeApiResourceMap,
  buildApiFixtureManifest,
  serializeApiFixtureManifest,
} from "./generator/index.ts";
import { decycleSchema } from "./generator/schema-utils.ts";
import { hashSpec } from "./meta/meta-store.ts";
import { findWorkspaceRoot } from "./workspace/root.ts";

/** Filename of the dereferenced spec snapshot inside `apis/<name>/`. */
export const SPEC_SNAPSHOT_FILENAME = "spec.json";

/**
 * Resolve a `collections.openapi_spec` value (which may be either a
 * workspace-relative path to a local snapshot or — for legacy entries — an
 * absolute path / URL) to a concrete file path or URL that
 * `readOpenApiSpec` can consume.
 *
 * Resolution order:
 *   1. URL (http/https) — return as-is
 *   2. Absolute filesystem path that exists — return as-is
 *   3. Workspace-relative path (e.g. `apis/resend/spec.json`) — resolve
 *      against the workspace root and verify existence
 *   4. Otherwise — return the original string and let the caller surface
 *      the failure with its own context
 */
export function resolveCollectionSpec(specRef: string): string {
  if (/^https?:\/\//i.test(specRef)) return specRef;
  if (specRef.startsWith("/") && existsSync(specRef)) return specRef;
  const root = findWorkspaceRoot().root;
  const local = resolve(root, specRef);
  if (existsSync(local)) return local;
  return specRef;
}

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
  // The dereferenced doc is captured here so we can copy it into the
  // workspace after the target dir is computed (below). We snapshot the
  // *dereferenced* form so all consumers (probe-*, generate, describe) read
  // a self-contained file — no external $ref resolution at runtime.
  let dereferencedDoc: unknown = null;
  if (spec) {
    const doc = await readOpenApiSpec(spec, { insecure: options.insecure });
    dereferencedDoc = doc;
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

  const workspaceRoot = findWorkspaceRoot().root;

  // Snapshot the dereferenced spec into apis/<name>/spec.json so all later
  // commands (catalog, describe, generate, probe-*) read a self-contained
  // local file. The spec lives inside the workspace and is git-trackable;
  // an external --spec path is only consulted at register/refresh time.
  let localSpecAbsPath: string | null = null;
  if (dereferencedDoc) {
    localSpecAbsPath = join(baseDir, SPEC_SNAPSHOT_FILENAME);
    writeFileSync(localSpecAbsPath, JSON.stringify(dereferencedDoc, null, 2) + "\n", "utf-8");

    // Emit the three derived artifacts. Skill code (scenarios + audit)
    // reads these instead of grep'ing the raw spec, so token cost stays
    // bounded regardless of API size.
    const endpoints = extractEndpoints(dereferencedDoc as any);
    const securitySchemes = extractSecuritySchemes(dereferencedDoc as any);
    const specHash = hashSpec(JSON.stringify(decycleSchema(dereferencedDoc)));
    const localSpecRelPath = relative(workspaceRoot, localSpecAbsPath).replace(/\\/g, "/");

    const catalog = buildCatalog({
      endpoints,
      securitySchemes,
      specSource: localSpecRelPath,
      specHash,
      apiName: name,
      apiVersion: (dereferencedDoc as any).info?.version,
      baseUrl,
    });
    writeFileSync(join(baseDir, ".api-catalog.yaml"), serializeCatalog(catalog), "utf-8");

    const resources = buildApiResourceMap({ endpoints, specHash });
    writeFileSync(join(baseDir, ".api-resources.yaml"), serializeApiResourceMap(resources), "utf-8");

    const fixtures = buildApiFixtureManifest({
      endpoints,
      securitySchemes,
      baseUrl: baseUrl || undefined,
      specHash,
    });
    writeFileSync(join(baseDir, ".api-fixtures.yaml"), serializeApiFixtureManifest(fixtures), "utf-8");
  }

  const normalizedTestPath = normalizePath(testPath);
  const normalizedBaseDir = normalizePath(baseDir);

  // Persist the workspace-relative path to the local snapshot in
  // collections.openapi_spec so we don't rely on the user's external path
  // sticking around. Falls back to the external path only when the snapshot
  // could not be created (no spec given to setupApi).
  // Don't run normalizePath on the relative form — it calls resolve() and
  // would re-absolutize the path. Posix-style separators are enough for
  // SQLite + Windows compat.
  const dbSpecPath = localSpecAbsPath
    ? relative(workspaceRoot, localSpecAbsPath).replace(/\\/g, "/")
    : (openapiSpec ?? undefined);

  // Create collection in DB
  const collectionId = createCollection({
    name,
    base_dir: normalizedBaseDir,
    test_path: normalizedTestPath,
    openapi_spec: dbSpecPath,
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
