/**
 * `zond doctor` — operator-friendly health check for a registered API.
 *
 * Surfaces three things the skill (and the user) need before running tests:
 *   1. Which `.env.yaml` variables are missing relative to `.api-fixtures.yaml`.
 *      Required gaps are blockers; optional gaps are warnings.
 *   2. Whether the artifact snapshots (`.api-catalog.yaml`,
 *      `.api-resources.yaml`, `.api-fixtures.yaml`) are in sync with the
 *      local `spec.json` (specHash match).
 *   3. The local `spec.json` itself — present? readable? matches what's
 *      registered in the DB?
 *
 * Output:
 *   - human form: structured, three sections.
 *   - --json envelope: { fixtures: { required, optional }, stale: [...], spec: { ... } }
 *
 * Exit codes:
 *   0 — all required fixtures present + artifacts fresh.
 *   1 — required fixture missing (the user must edit `.env.yaml`).
 *   2 — workspace problem (no API, missing artifact, stale).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import YAML from "yaml";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId, listCollections } from "../../db/queries.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { loadEnvironment } from "../../core/parser/variables.ts";
import { loadSecretsFromAncestor } from "../../core/secrets/secrets-file.ts";
import { loadIdentityFromAncestor } from "../../core/identity/identity-file.ts";
import { hashSpec } from "../../core/meta/meta-store.ts";
import { decycleSchema } from "../../core/generator/schema-utils.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError } from "../output.ts";

export interface DoctorOptions {
  api?: string;
  json?: boolean;
  dbPath?: string;
}

interface FixtureRow {
  name: string;
  source: string;
  required: boolean;
  description: string;
  defaultValue?: string;
  affectedEndpoints: string[];
}

interface FixtureManifestShape {
  generatedAt?: string;
  specHash?: string;
  fixtures: FixtureRow[];
}

interface ArtifactStaleness {
  file: string;
  expected: string | null;
  actual: string | null;
  fresh: boolean;
}

/** TASK-172 (m-10): per-fixture metadata returned by doctor. Secrets
 *  carry no value (only set/length/secret:true); identity values are
 *  visible because that's the whole point of `.identity.yaml` (locally
 *  triagable, opt-in redaction with --redact-identity). */
export interface FixtureMetaRow {
  name: string;
  set: boolean;
  /** UTF-16 length (string.length). Useful for "is the right token
   *  pasted, is it the 64-char one or the 32-char one?" */
  length: number;
  source: string;
  description: string;
  affectedEndpoints: string[];
  /** True when the value came from `.secrets.yaml` or is otherwise
   *  registered in the SecretRegistry. `value` is omitted for secrets. */
  secret?: true;
  /** True when the value came from `.identity.yaml`. */
  identity?: true;
  /** Resolved value — present for env / identity entries, omitted for
   *  secrets so doctor never echoes a token. */
  value?: string;
}

interface DoctorReport {
  api: string;
  mode: "spec" | "run-only";
  baseDir: string;
  spec: {
    path: string;
    exists: boolean;
    sha: string | null;
  };
  fixtures: {
    required: FixtureMetaRow[];
    optional: FixtureMetaRow[];
    extraInEnv: string[];   // keys in .env.yaml that aren't in the manifest (informational)
  };
  staleArtifacts: ArtifactStaleness[];
  blockedRequired: number;
  warnings: string[];
}

interface DoctorRunOnlyReport {
  api: string;
  mode: "run-only";
  baseDir: string;
  envVars: Record<string, string>;
  recommendation: string;
}

/** Read & parse a YAML artifact, returning null if missing. */
function readYamlIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return YAML.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readArtifactSpecHash(path: string): string | null {
  const doc = readYamlIfExists<{ specHash?: unknown }>(path);
  return typeof doc?.specHash === "string" ? doc.specHash : null;
}

function maskSecret(value: string): string {
  if (value.length <= 6) return "***";
  return `${"*".repeat(Math.max(value.length - 4, 4))}set`;
}

function isLikelySecret(name: string): boolean {
  return /token|secret|key|password|pwd|api_key/i.test(name);
}

export async function doctorCommand(opts: DoctorOptions): Promise<number> {
  try {
    getDb(opts.dbPath);
  } catch (err) {
    const message = `DB unavailable: ${(err as Error).message}`;
    if (opts.json) printJson(jsonError("doctor", [message]));
    else printError(message);
    return 2;
  }

  // Resolve target API
  let apiName = opts.api;
  if (!apiName) {
    const cols = listCollections();
    if (cols.length === 0) {
      const message = "No API registered. Run `zond add api <name> --spec <path>` first.";
      if (opts.json) printJson(jsonError("doctor", [message]));
      else printError(message);
      return 2;
    }
    if (cols.length > 1) {
      const message = `Multiple APIs registered (${cols.map(c => c.name).join(", ")}). Pass --api <name>.`;
      if (opts.json) printJson(jsonError("doctor", [message]));
      else printError(message);
      return 2;
    }
    apiName = cols[0]!.name;
  }

  const collection = findCollectionByNameOrId(apiName);
  if (!collection) {
    const message = `API '${apiName}' not found.`;
    if (opts.json) printJson(jsonError("doctor", [message]));
    else printError(message);
    return 2;
  }

  const baseDir = collection.base_dir
    ?? join(findWorkspaceRoot().root, "apis", apiName);

  // Spec-less API: short-circuit. Such APIs are registered with --base-url
  // only and have no .api-catalog/.api-resources/.api-fixtures to check. We
  // surface what we have (env vars, base_dir) and tell the user how to upgrade.
  if (!collection.openapi_spec) {
    const envVars = await loadEnvironment(undefined, baseDir);
    const recommendation =
      `This API has no OpenAPI spec — generate/probe/validate-schema are disabled. ` +
      `Run \`zond refresh-api ${apiName} --spec <path|url>\` to attach one.`;
    const report: DoctorRunOnlyReport = {
      api: apiName,
      mode: "run-only",
      baseDir,
      envVars,
      recommendation,
    };
    if (opts.json) {
      printJson(jsonOk("doctor", report));
    } else {
      printRunOnlyHuman(report);
    }
    return 0;
  }

  // 1. Spec snapshot
  let specAbsPath: string | null = null;
  let specSha: string | null = null;
  let specExists = false;
  if (collection.openapi_spec) {
    try {
      specAbsPath = resolveCollectionSpec(collection.openapi_spec);
      if (!isAbsolute(specAbsPath)) {
        specAbsPath = resolve(findWorkspaceRoot().root, specAbsPath);
      }
      specExists = existsSync(specAbsPath);
      if (specExists) {
        try {
          const raw = readFileSync(specAbsPath, "utf-8");
          const parsed = JSON.parse(raw);
          specSha = hashSpec(JSON.stringify(decycleSchema(parsed)));
        } catch {
          // unreadable / not JSON — leave sha null
        }
      }
    } catch (err) {
      // resolveCollectionSpec throws on legacy/stale workspace — that's
      // exactly what doctor should report, just without crashing.
      const m = (err as Error).message;
      if (opts.json) printJson(jsonError("doctor", [m]));
      else printError(m);
      return 2;
    }
  }

  // 2. Artifact staleness — compare each artifact's specHash to spec.json sha
  const staleArtifacts: ArtifactStaleness[] = [];
  for (const [file, label] of [
    [".api-catalog.yaml", "catalog"],
    [".api-resources.yaml", "resources"],
    [".api-fixtures.yaml", "fixtures"],
  ] as const) {
    const path = join(baseDir, file);
    if (!existsSync(path)) {
      staleArtifacts.push({ file: label, expected: specSha, actual: null, fresh: false });
      continue;
    }
    const actual = readArtifactSpecHash(path);
    const fresh = !!specSha && actual === specSha;
    staleArtifacts.push({ file: label, expected: specSha, actual, fresh });
  }

  // 3. Fixtures manifest vs .env.yaml
  const manifestPath = join(baseDir, ".api-fixtures.yaml");
  const manifest = readYamlIfExists<FixtureManifestShape>(manifestPath);
  const envVars = await loadEnvironment(undefined, baseDir);

  // TASK-172 (m-10): classify each fixture as secret / identity / plain
  // env so doctor never echoes a raw secret. The secret registry was
  // populated by loadEnvironment above (which loads .secrets.yaml as a
  // side-effect); identity comes from `.secrets`'s sibling file.
  const secretRaw = loadSecretsFromAncestor(baseDir);
  const identityRaw = loadIdentityFromAncestor(baseDir);
  const secretKeys = new Set(secretRaw ? Object.keys(secretRaw.values) : []);
  const identityKeys = new Set(identityRaw ? Object.keys(identityRaw.values) : []);

  const requiredOut: DoctorReport["fixtures"]["required"] = [];
  const optionalOut: DoctorReport["fixtures"]["optional"] = [];
  const declaredVars = new Set<string>();

  if (manifest?.fixtures) {
    for (const f of manifest.fixtures) {
      declaredVars.add(f.name);
      const value = envVars[f.name];
      const set = typeof value === "string" && value.length > 0;
      const isSecret = secretKeys.has(f.name);
      const isIdentity = identityKeys.has(f.name);
      const row: FixtureMetaRow = {
        name: f.name,
        set,
        length: typeof value === "string" ? value.length : 0,
        source: f.source,
        description: f.description,
        affectedEndpoints: f.affectedEndpoints ?? [],
        ...(isSecret ? { secret: true as const } : {}),
        ...(isIdentity ? { identity: true as const } : {}),
        // Identity values stay visible (mental model: identity is for
        // locally-triagable but personally-identifying data; `--redact-
        // identity` swaps it for placeholders only at outbound time).
        ...(!isSecret && set ? { value } : {}),
      };
      if (f.required) requiredOut.push(row);
      else optionalOut.push(row);
    }
  }

  const extraInEnv = Object.keys(envVars).filter(k => !declaredVars.has(k)).sort();
  const blockedRequired = requiredOut.filter(r => !r.set).length;

  const warnings: string[] = [];
  if (!specExists) warnings.push(`spec.json not found at ${specAbsPath}`);
  if (!manifest) warnings.push(`.api-fixtures.yaml missing — run \`zond refresh-api ${apiName}\``);

  const report: DoctorReport = {
    api: apiName,
    mode: "spec",
    baseDir,
    spec: {
      path: specAbsPath ?? "",
      exists: specExists,
      sha: specSha,
    },
    fixtures: {
      required: requiredOut,
      optional: optionalOut,
      extraInEnv,
    },
    staleArtifacts,
    blockedRequired,
    warnings,
  };

  // ── Output ──
  if (opts.json) {
    printJson(jsonOk("doctor", report));
  } else {
    printHuman(report, envVars);
  }

  if (blockedRequired > 0) return 1;
  if (staleArtifacts.some(s => !s.fresh) || !specExists || !manifest) return 2;
  return 0;
}

function printHuman(r: DoctorReport, envVars: Record<string, string>): void {
  const out = process.stdout;
  out.write(`API: ${r.api}\n`);
  out.write(`Workspace dir: ${r.baseDir}\n\n`);

  // Spec snapshot
  out.write(`Spec snapshot (${r.spec.path}):\n`);
  if (!r.spec.exists) {
    out.write(`  ✗ MISSING — run \`zond refresh-api ${r.api}\`\n\n`);
  } else {
    out.write(`  ✓ present, sha ${r.spec.sha?.slice(0, 12) ?? "?"}…\n\n`);
  }

  // Artifacts
  out.write(`Artifact freshness:\n`);
  for (const s of r.staleArtifacts) {
    if (!s.actual) {
      out.write(`  ✗ ${s.file}: missing\n`);
    } else if (s.fresh) {
      out.write(`  ✓ ${s.file}: fresh\n`);
    } else {
      out.write(`  ⚠ ${s.file}: STALE (artifact specHash ${s.actual.slice(0, 12)}… ≠ spec.json ${s.expected?.slice(0, 12)}…)\n`);
    }
  }
  out.write("\n");

  // Required fixtures
  out.write(`Required fixtures (${r.fixtures.required.length}):\n`);
  if (r.fixtures.required.length === 0) {
    out.write(`  (none)\n`);
  } else {
    for (const f of r.fixtures.required) {
      const icon = f.set ? "✓" : "✗";
      // TASK-172 (m-10): secrets show metadata only (set + length); identity
      // is visible because the user owns those values; plain env shows raw.
      const value = !f.set
        ? "UNSET"
        : f.secret
          ? `set (${f.length} chars, secret)`
          : f.identity
            ? `${envVars[f.name]} (identity)`
            : envVars[f.name];
      const detail = f.set ? "" : ` (${f.affectedEndpoints.length === 1 && f.affectedEndpoints[0] === "*" ? "all endpoints" : `blocks ${f.affectedEndpoints.length} endpoint${f.affectedEndpoints.length === 1 ? "" : "s"}`})`;
      out.write(`  ${icon} ${f.name.padEnd(20)} ${String(value).padEnd(40)} [${f.source}]${detail}\n`);
    }
  }
  out.write("\n");

  // Optional fixtures
  out.write(`Optional fixtures (${r.fixtures.optional.length}):\n`);
  if (r.fixtures.optional.length === 0) {
    out.write(`  (none)\n`);
  } else {
    for (const f of r.fixtures.optional) {
      const icon = f.set ? "✓" : "⚠";
      out.write(`  ${icon} ${f.name.padEnd(20)} ${(f.set ? "set" : "unset").padEnd(40)} [${f.source}]\n`);
    }
  }
  out.write("\n");

  if (r.fixtures.extraInEnv.length > 0) {
    out.write(`Other variables in .env.yaml (not in manifest, informational):\n`);
    for (const k of r.fixtures.extraInEnv) out.write(`  • ${k}\n`);
    out.write("\n");
  }

  // Suggested next
  if (r.blockedRequired > 0) {
    out.write(`Next: edit ${r.baseDir}/.env.yaml and fill the ${r.blockedRequired} required value${r.blockedRequired === 1 ? "" : "s"}, then re-run \`zond doctor --api ${r.api}\`.\n`);
  } else if (r.staleArtifacts.some(s => !s.fresh)) {
    out.write(`Next: artifacts are out of sync — run \`zond refresh-api ${r.api}\`.\n`);
  } else {
    out.write(`All checks passed. Workspace is ready.\n`);
  }

  for (const w of r.warnings) out.write(`Warning: ${w}\n`);
}

function printRunOnlyHuman(r: DoctorRunOnlyReport): void {
  const out = process.stdout;
  out.write(`API: ${r.api}\n`);
  out.write(`Mode: run-only (no OpenAPI spec)\n`);
  out.write(`Workspace dir: ${r.baseDir}\n\n`);
  const keys = Object.keys(r.envVars);
  out.write(`Environment variables (${keys.length}):\n`);
  if (keys.length === 0) {
    out.write(`  (none) — write \`base_url: ...\` into ${r.baseDir}/.env.yaml\n`);
  } else {
    for (const k of keys) {
      const v = isLikelySecret(k) ? maskSecret(r.envVars[k]!) : r.envVars[k];
      out.write(`  • ${k.padEnd(20)} ${v}\n`);
    }
  }
  out.write(`\n${r.recommendation}\n`);
}

import type { Command } from "commander";
import { globalJson as globalJsonResolver } from "../resolve.ts";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose registered API: fixture gaps in .env.yaml + artifact freshness vs spec.json")
    .option("--api <name>", "API collection name (defaults to the only registered one)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await doctorCommand({
        api: opts.api,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        json: globalJsonResolver(cmd),
      });
    });
}
