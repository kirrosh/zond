import { resolve, join, relative } from "path";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
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
import { schemeVarName } from "./generator/suite-generator.ts";
import type { SecuritySchemeInfo } from "./generator/types.ts";
import { hashSpec } from "./meta/meta-store.ts";
import { findWorkspaceRoot } from "./workspace/root.ts";
import { recordGeneratedFiles, type RecordInput } from "./workspace/manifest.ts";
import { CANONICAL_IDENTITY_KEYS } from "./identity/identity-file.ts";

/** Filename of the dereferenced spec snapshot inside `apis/<name>/`. */
export const SPEC_SNAPSHOT_FILENAME = "spec.json";

interface WriteArtifactsParams {
  /** Dereferenced OpenAPI document. */
  doc: unknown;
  /** Absolute path to apis/<name>/. */
  baseDir: string;
  /** Collection name (goes into the catalog header). */
  apiName: string;
  /** Resolved server URL or "". */
  baseUrl: string;
  /** Absolute workspace root, used to compute the relative specSource. */
  workspaceRoot: string;
  /** Caller label for manifest entries (defaults to "zond add api"). */
  by?: string;
}

/**
 * Snapshot the dereferenced spec into `apis/<name>/spec.json` and emit the
 * three derived artifacts (`.api-catalog.yaml`, `.api-resources.yaml`,
 * `.api-fixtures.yaml`). Pure side-effect; safe to call from `setupApi` at
 * register time and from `refreshApi` for re-snapshot.
 */
export function writeArtifactsFromDoc(params: WriteArtifactsParams): void {
  const { doc, baseDir, apiName, baseUrl, workspaceRoot, by = "zond add api" } = params;
  const localSpecAbsPath = join(baseDir, SPEC_SNAPSHOT_FILENAME);
  // Pass through decycleSchema first — large specs (Stripe, GitHub) contain
  // mutually-recursive `$ref` chains that resolve to true object cycles after
  // dereference, and raw JSON.stringify crashes on those with "cannot
  // serialize cyclic structures" (ARV-145). decycleSchema collapses the
  // second visit to `{ "x-circular": true }` (vendor-extension sentinel —
  // NOT `$ref`, otherwise the parser tries to resolve "[Circular]" as a
  // file path when re-reading spec.json, ARV-146) so the on-disk snapshot
  // is self-contained, parser-safe JSON.
  let serialized: string;
  try {
    serialized = JSON.stringify(decycleSchema(doc), null, 2);
  } catch (err) {
    const m = (err as Error).message;
    throw new Error(
      `spec_serialize_failed: could not serialize dereferenced spec for '${apiName}' — ${m}. ` +
      `This usually means the spec contains a structure decycleSchema could not collapse; please open an issue with the spec URL.`,
    );
  }
  writeFileSync(localSpecAbsPath, serialized + "\n", "utf-8");

  const endpoints = extractEndpoints(doc as any);
  const securitySchemes = extractSecuritySchemes(doc as any);
  // Hash the on-disk file bytes — this is what `zond doctor` re-hashes when
  // checking artifact freshness (TASK-215). Both sides now read the decycled
  // form: setup-api writes it here, doctor re-reads the same file.
  const specHash = hashSpec(readFileSync(localSpecAbsPath, "utf-8"));
  const localSpecRelPath = relative(workspaceRoot, localSpecAbsPath).replace(/\\/g, "/");

  const catalog = buildCatalog({
    endpoints,
    securitySchemes,
    specSource: localSpecRelPath,
    specHash,
    apiName,
    apiVersion: (doc as any).info?.version,
    baseUrl,
  });
  const catalogPath = join(baseDir, ".api-catalog.yaml");
  writeFileSync(catalogPath, serializeCatalog(catalog), "utf-8");

  const resources = buildApiResourceMap({ endpoints, specHash });
  const resourcesPath = join(baseDir, ".api-resources.yaml");
  writeFileSync(resourcesPath, serializeApiResourceMap(resources), "utf-8");

  const fixtures = buildApiFixtureManifest({
    endpoints,
    securitySchemes,
    baseUrl: baseUrl || undefined,
    specHash,
    resourceMap: resources,
  });
  const fixturesPath = join(baseDir, ".api-fixtures.yaml");
  writeFileSync(fixturesPath, serializeApiFixtureManifest(fixtures), "utf-8");

  // Record artifacts in .zond/manifest.json (TASK-156).
  try {
    const entries: RecordInput[] = [
      { path: localSpecAbsPath, by, api: apiName, category: "spec" },
      { path: catalogPath, by, api: apiName, category: "catalog" },
      { path: resourcesPath, by, api: apiName, category: "resources" },
      { path: fixturesPath, by, api: apiName, category: "fixtures" },
    ];
    recordGeneratedFiles(workspaceRoot, entries);
  } catch {
    // best-effort
  }
}

/**
 * Resolve a `collections.openapi_spec` value to a concrete file path the
 * caller can read. Throws on a legacy / broken workspace so the user gets
 * a single clear instruction instead of a downstream ENOENT.
 *
 * Resolution order:
 *   1. URL (http/https) — return as-is.
 *   2. Workspace-relative path (e.g. `apis/<name>/spec.json`) that exists.
 *   3. Absolute filesystem path that exists. Treated as legacy: the spec
 *      is outside the workspace and not snapshotted into `apis/<name>/`.
 *      We let it through, but `assertLocalSpec` (used by run/report/doctor)
 *      will reject it.
 *   4. Otherwise — throw a "legacy / stale workspace" error pointing at
 *      `zond refresh-api`.
 */
export function resolveCollectionSpec(specRef: string): string {
  if (/^https?:\/\//i.test(specRef)) return specRef;
  const root = findWorkspaceRoot().root;
  const local = resolve(root, specRef);
  if (existsSync(local)) return local;
  if (specRef.startsWith("/") && existsSync(specRef)) return specRef;
  throw new Error(
    `Spec for this API is missing at ${local}` +
    (specRef.startsWith("/") ? ` (DB recorded an external path: ${specRef})` : "") +
    `. The workspace looks legacy or stale — run \`zond refresh-api <name> [--spec <path|url>]\` to re-snapshot.`,
  );
}

/**
 * Strict variant for code paths that must read the workspace-local
 * snapshot (run/report/doctor). Returns the local absolute path or
 * throws — never returns an external URL or path.
 */
export function assertLocalSpec(specRef: string, apiName: string): string {
  if (/^https?:\/\//i.test(specRef)) {
    throw new Error(
      `API '${apiName}' has a remote spec recorded (${specRef}) but no local snapshot. ` +
      `Run \`zond refresh-api ${apiName}\` to materialise apis/${apiName}/${SPEC_SNAPSHOT_FILENAME}.`,
    );
  }
  const root = findWorkspaceRoot().root;
  const local = resolve(root, specRef);
  if (!existsSync(local)) {
    throw new Error(
      `Local spec missing for API '${apiName}' (expected ${local}). ` +
      `Run \`zond refresh-api ${apiName}\` to regenerate it.`,
    );
  }
  return local;
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
  /** Auth-related env-var names auto-seeded as `@secret:<name>` (TASK-209). */
  authVars?: string[];
  warnings?: string[];
}

/**
 * Walk the security schemes and derive the env-var names that
 * `@readme/openapi-parser`-derived suites/probes will reference for auth
 * tokens. Mirrors `getAuthHeaders` in src/core/probe/shared.ts:
 *   - HTTP bearer/basic/empty-scheme → schemeVarName(...) (default "auth_token")
 *   - apiKey in header named "Authorization" → schemeVarName(...)
 *   - apiKey in header (other name) → "api_key"
 */
function deriveAuthVarNames(schemes: SecuritySchemeInfo[]): string[] {
  const vars = new Set<string>();
  for (const s of schemes) {
    if (s.type === "http" && (s.scheme === "bearer" || s.scheme === "basic" || !s.scheme)) {
      vars.add(schemeVarName(s, schemes));
    } else if (s.type === "apiKey" && s.in === "header" && s.apiKeyName) {
      if (s.apiKeyName === "Authorization") vars.add(schemeVarName(s, schemes));
      else vars.add("api_key");
    }
  }
  return [...vars];
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
  let authVarNames: string[] = [];
  if (spec) {
    const doc = await readOpenApiSpec(spec, { insecure: options.insecure });
    // Validate the document looks like OpenAPI/Swagger before we snapshot it.
    // dereference() happily round-trips arbitrary JSON (e.g. a marketing-site
    // landing payload), so without this guard `zond add api foo --spec
    // https://example.com` silently registers a 0-endpoint API.
    const docAny = doc as any;
    const hasOpenApiField = typeof docAny?.openapi === "string";
    const hasSwaggerField = typeof docAny?.swagger === "string";
    if (!hasOpenApiField && !hasSwaggerField) {
      throw new Error(
        `Spec at ${spec} is not an OpenAPI/Swagger document — missing top-level 'openapi' (3.x) or 'swagger' (2.x) field. Check the URL points to the JSON spec, not the API root.`,
      );
    }
    dereferencedDoc = doc;
    openapiSpec = spec;
    if ((doc as any).servers?.[0]?.url) {
      baseUrl = (doc as any).servers[0].url;
      // Resolve OpenAPI server variables (e.g. {region}) using their declared defaults.
      // Without this, the raw placeholder ends up in .env.yaml and causes cryptic TLS
      // errors because the hostname literally contains "{region}".
      const serverVars = (doc as any).servers[0].variables as
        Record<string, { default?: string }> | undefined;
      if (serverVars && baseUrl.includes("{")) {
        baseUrl = baseUrl.replace(/\{([^}]+)\}/g, (_: string, name: string) =>
          serverVars[name]?.default ?? `{${name}}`
        );
      }
      // Warn if any placeholder remains unresolved (spec didn't provide a default).
      const unresolved = [...baseUrl.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
      if (unresolved.length > 0) {
        warnings.push(
          `base_url contains unresolved server variable${unresolved.length === 1 ? "" : "s"}: ${unresolved.map(v => `{${v}}`).join(", ")}. Edit .env.yaml and replace with a concrete value.`,
        );
      }
    }
    if (baseUrl && !baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      warnings.push(`Spec server URL "${baseUrl}" is relative — requests will fail without a host. Override with envVars: {"base_url": "https://your-host${baseUrl}"}`);
    }
    specTitle = (doc as any).info?.title;
    const endpoints = extractEndpoints(doc);
    endpointCount = endpoints.length;
    authVarNames = deriveAuthVarNames(extractSecuritySchemes(doc));

    if (endpointCount === 0) {
      const hasPaths = docAny?.paths && typeof docAny.paths === "object" && Object.keys(docAny.paths).length > 0;
      warnings.push(
        hasPaths
          ? `Spec declares paths but no operations were extracted — every method may be filtered out (deprecated, unsupported method, etc.). Verify with \`zond catalog --api <name>\`.`
          : `Spec contains 0 endpoints — 'paths' field is empty or missing. generate/probe/checks will produce nothing until the spec is fixed or replaced.`,
      );
    }

    // Collect unique path parameters. The default is empty string so that
    // generated `skip_if: "{{<id>}} =="` checks auto-skip until the user
    // fills the value in .env.yaml (TASK-210). Spec-provided examples are
    // kept verbatim so they are still useful as concrete fixtures.
    for (const ep of endpoints) {
      for (const param of (ep.parameters ?? []).filter(p => p.in === "path")) {
        if (pathParams.has(param.name)) continue;
        const schema = param.schema as any;
        if (param.example !== undefined) pathParams.set(param.name, String(param.example));
        else if (schema?.example !== undefined) pathParams.set(param.name, String(schema.example));
        else pathParams.set(param.name, "");
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

  // Track whether we created baseDir from scratch so we can clean it up on
  // failure — without this, a crash mid-setup (e.g. JSON.stringify on a
  // cyclic spec, ARV-145) leaves apis/<slug>/tests/ behind and confuses the
  // next `zond add api` invocation.
  const baseDirPreExisted = existsSync(baseDir);

  // Create directories
  mkdirSync(testPath, { recursive: true });

  try {
    return await finalizeSetup({
      name,
      baseDir,
      testPath,
      baseUrl,
      pathParams,
      authVarNames,
      envVarsOverride: options.envVars,
      spec,
      dereferencedDoc,
      openapiSpec,
      endpointCount,
      warnings,
    });
  } catch (err) {
    // Roll back partial filesystem state (apis/<slug>/tests/, spec.json, etc.)
    // when we created the dir from scratch. Without this, the next
    // `zond add api <same-name>` would still find a stale dir and demand
    // --force, even though no collection was actually registered. ARV-145.
    if (!baseDirPreExisted) {
      try { rmSync(baseDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    throw err;
  }
}

interface FinalizeSetupParams {
  name: string;
  baseDir: string;
  testPath: string;
  baseUrl: string;
  pathParams: Map<string, string>;
  authVarNames: string[];
  envVarsOverride?: Record<string, string>;
  spec?: string;
  dereferencedDoc: unknown;
  openapiSpec: string | null;
  endpointCount: number;
  warnings: string[];
}

async function finalizeSetup(p: FinalizeSetupParams): Promise<SetupApiResult> {
  const {
    name, baseDir, testPath, baseUrl, pathParams, authVarNames,
    envVarsOverride, spec, dereferencedDoc, openapiSpec, endpointCount, warnings,
  } = p;

  // Build environment variables
  const envVars: Record<string, string> = {};
  if (baseUrl) envVars.base_url = baseUrl;
  // Add path parameter defaults (before user overrides)
  for (const [k, v] of pathParams) {
    if (!(k in envVars)) envVars[k] = v;
  }
  // Auto-wire auth env-vars to .secrets.yaml so generated suites and probes
  // resolve `{{auth_token}}` (etc.) without manual editing of .env.yaml
  // (TASK-209). The matching `<var>: ""` placeholder is seeded into
  // .secrets.yaml below — the user only fills the secret value.
  for (const v of authVarNames) {
    if (!(v in envVars)) envVars[v] = `@secret:${v}`;
  }
  // ARV-201 (R10/F2): when the spec declares no `components.securitySchemes`
  // (GitHub publishes its OpenAPI this way), `deriveAuthVarNames` returns []
  // and the loop above is a no-op — yet `zond request --api <name>` knows
  // to attach `Authorization: Bearer <auth_token>` if the env carries an
  // `auth_token`. Mirror the `.secrets.yaml` fallback (which already seeds
  // `auth_token: ""` when authVarNames is empty) into `.env.yaml` so users
  // do not need to hand-add `auth_token: "@secret:auth_token"` just to
  // surface the Bearer header on bare specs.
  if (authVarNames.length === 0 && !("auth_token" in envVars)) {
    envVars.auth_token = "@secret:auth_token";
  }
  if (envVarsOverride) {
    Object.assign(envVars, envVarsOverride);
  }

  // Spec-less registration is allowed, but we need a base_url from somewhere
  // (server URL extracted from the spec, or envVars.base_url passed in by the
  // caller). Without it the API is useless — `zond run` can't resolve {{base_url}}.
  if (!spec && !envVars.base_url) {
    throw new Error("setupApi requires --spec or envVars.base_url to register an API");
  }

  // Write .env.yaml in base_dir
  if (Object.keys(envVars).length > 0) {
    const envFilePath = join(baseDir, ".env.yaml");
    writeFileSync(envFilePath, toYaml(envVars) + "\n", "utf-8");
  }

  // Create/update .gitignore to exclude env / secret files
  const gitignorePath = join(baseDir, ".gitignore");
  let gitignoreContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  let gitignoreDirty = false;
  if (!gitignoreContent.includes(".env*.yaml")) {
    gitignoreContent +=
      (gitignoreContent.endsWith("\n") || !gitignoreContent ? "" : "\n") + ".env*.yaml\n";
    gitignoreDirty = true;
  }
  // TASK-170 (m-10): keep `.secrets.yaml` git-invisible. Older `.env*.yaml`
  // pattern matched it accidentally; pin it explicitly so a future glob
  // narrowing can't regress.
  if (!gitignoreContent.includes(".secrets.yaml")) {
    gitignoreContent += ".secrets.yaml\n";
    gitignoreDirty = true;
  }
  // TASK-174 (m-10): identity values are not secrets but they identify
  // the user's account; keep them out of git too.
  if (!gitignoreContent.includes(".identity.yaml")) {
    gitignoreContent += ".identity.yaml\n";
    gitignoreDirty = true;
  }
  if (gitignoreDirty) {
    writeFileSync(gitignorePath, gitignoreContent, "utf-8");
  }

  // Seed `.secrets.yaml` placeholder once. The file lives gitignored
  // alongside `.env.yaml`; values placed here are auto-registered with
  // the SecretRegistry on load and never appear in artifacts.
  const secretsPath = join(baseDir, ".secrets.yaml");
  if (!existsSync(secretsPath)) {
    const seedKeys = authVarNames.length > 0 ? authVarNames : ["auth_token"];
    const lines = [
      "# .secrets.yaml — gitignored, holds raw secret values.",
      "# Reference these in .env.yaml as @secret:<key>.",
      "# Values here are auto-registered for redaction in DB writes,",
      "# HTML/JSON/JUnit reports, case-studies, and probe digests.",
    ];
    for (const k of seedKeys) lines.push(`${k}: ""  # required for live probes`);
    lines.push("");
    writeFileSync(secretsPath, lines.join("\n"), "utf-8");
  }

  // TASK-174 (m-10): seed `.identity.yaml` with placeholders for any
  // canonical identity-keys that appear as path-params in the spec. The
  // file is gitignored — values are visible locally for triage and
  // hidden from outbound shares only when --redact-identity is set.
  const identityKeys = [...pathParams.keys()].filter((k) =>
    CANONICAL_IDENTITY_KEYS.has(k),
  );
  if (identityKeys.length > 0) {
    const identityPath = join(baseDir, ".identity.yaml");
    if (!existsSync(identityPath)) {
      const lines = [
        "# .identity.yaml — gitignored, holds non-secret-but-identifying values.",
        "# Reference these in .env.yaml as @identity:<key>.",
        "# Values are visible locally and in case-study drafts; pass",
        "# --redact-identity (TASK-173) to swap them for placeholders when",
        "# sharing reports outbound.",
      ];
      for (const k of identityKeys.sort()) {
        lines.push(`${k}: ""  # fill with your ${k}`);
      }
      lines.push("");
      writeFileSync(identityPath, lines.join("\n"), "utf-8");
    }
  }

  const workspaceRoot = findWorkspaceRoot().root;

  // Snapshot the dereferenced spec into apis/<name>/spec.json so all later
  // commands (catalog, describe, generate, probe-*) read a self-contained
  // local file. The spec lives inside the workspace and is git-trackable;
  // an external --spec path is only consulted at register/refresh time.
  let localSpecAbsPath: string | null = null;
  if (dereferencedDoc) {
    localSpecAbsPath = join(baseDir, SPEC_SNAPSHOT_FILENAME);
    writeArtifactsFromDoc({
      doc: dereferencedDoc,
      baseDir,
      apiName: name,
      baseUrl,
      workspaceRoot,
    });
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
    ...(authVarNames.length > 0 ? { authVars: authVarNames } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
