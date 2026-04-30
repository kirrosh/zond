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

interface DoctorReport {
  api: string;
  baseDir: string;
  spec: {
    path: string;
    exists: boolean;
    sha: string | null;
  };
  fixtures: {
    required: { name: string; set: boolean; source: string; description: string; affectedEndpoints: string[] }[];
    optional: { name: string; set: boolean; source: string; description: string; affectedEndpoints: string[] }[];
    extraInEnv: string[];   // keys in .env.yaml that aren't in the manifest (informational)
  };
  staleArtifacts: ArtifactStaleness[];
  blockedRequired: number;
  warnings: string[];
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

  const requiredOut: DoctorReport["fixtures"]["required"] = [];
  const optionalOut: DoctorReport["fixtures"]["optional"] = [];
  const declaredVars = new Set<string>();

  if (manifest?.fixtures) {
    for (const f of manifest.fixtures) {
      declaredVars.add(f.name);
      const set = typeof envVars[f.name] === "string" && envVars[f.name]!.length > 0;
      const row = {
        name: f.name,
        set,
        source: f.source,
        description: f.description,
        affectedEndpoints: f.affectedEndpoints ?? [],
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
      const value = f.set
        ? (isLikelySecret(f.name) ? maskSecret(envVars[f.name]!) : envVars[f.name])
        : "UNSET";
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
