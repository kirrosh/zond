/**
 * `zond add api <name> --spec <path|url>` — register a new API in the
 * current workspace.
 *
 * The split from `zond init --spec` exists so the two operations
 * (workspace bootstrap vs. API registration) have separate names and
 * separate skill mentions. `init --spec` still works as a deprecated
 * alias.
 *
 * This command refuses to run when no workspace marker is present,
 * pointing the user at `zond init` first. setupApi handles spec
 * snapshot + artifact generation.
 */

import { setupApi, type SetupApiResult } from "../../core/setup-api.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { jsonOk, jsonError, printJson, zerr } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";

export interface AddApiOptions {
  name: string;
  spec?: string;
  baseUrl?: string;
  dir?: string;
  force?: boolean;
  insecure?: boolean;
  caPath?: string;
  dbPath?: string;
  json?: boolean;
}

export async function addApiCommand(opts: AddApiOptions): Promise<number> {
  const ws = findWorkspaceRoot();
  if (ws.fromFallback) {
    const m = `No workspace detected (no zond.config.yml / .zond / zond.db / apis marker). Run \`zond init\` first to bootstrap a workspace.`;
    if (opts.json) printJson(jsonError("add-api", [m])); else printError(m);
    return 2;
  }

  const envVars: Record<string, string> = {};
  if (opts.baseUrl) envVars.base_url = opts.baseUrl;

  let result: SetupApiResult;
  try {
    result = await setupApi({
      name: opts.name,
      spec: opts.spec,
      dir: opts.dir,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      dbPath: opts.dbPath,
      force: opts.force,
      insecure: opts.insecure,
      caPath: opts.caPath,
    });
  } catch (err) {
    const m = (err as Error).message;
    // Tag known spec-ingest failures with a structured code so downstream
    // tooling (skills, retry logic) can branch on it (ARV-145). Cyclic
    // structures escape decycleSchema only when @readme/openapi-parser
    // builds an unusual graph — surface that as spec_load_failure with a
    // pointer to the underlying serializer message.
    const isCycleError = /cyclic structures|spec_serialize_failed/i.test(m);
    const errInput = isCycleError ? zerr("spec_load_failure", m) : m;
    if (opts.json) printJson(jsonError("add-api", [errInput])); else printError(m);
    return 2;
  }

  const mode: "spec" | "run-only" = opts.spec ? "spec" : "run-only";
  const artifacts = mode === "spec"
    ? ["spec.json", ".api-catalog.yaml", ".api-resources.yaml", ".api-fixtures.yaml", ".env.yaml"]
    : [".env.yaml"];

  if (opts.json) {
    printJson(jsonOk("add-api", {
      api: opts.name,
      mode,
      collectionId: result.collectionId,
      baseDir: result.baseDir,
      testPath: result.testPath,
      endpoints: result.specEndpoints,
      artifacts,
    }, result.warnings));
  } else {
    if (mode === "spec") {
      printSuccess(`Registered API '${opts.name}' at ${result.baseDir} (${result.specEndpoints} endpoints)`);
      process.stdout.write(`  Artifacts: spec.json + .api-catalog.yaml + .api-resources.yaml + .api-fixtures.yaml\n`);
      if (result.authVars && result.authVars.length > 0) {
        const list = result.authVars.map((v) => `\`${v}\``).join(", ");
        process.stdout.write(`  Auth required: fill ${list} in ${result.baseDir}/.secrets.yaml (already wired via @secret in .env.yaml).\n`);
      }
      process.stdout.write(`  Next: run \`zond doctor --api ${opts.name}\` to see required fixtures.\n`);
    } else {
      printSuccess(`Registered API '${opts.name}' at ${result.baseDir} (no spec — run-only mode)`);
      process.stdout.write(`  Artifacts: .env.yaml (base_url=${opts.baseUrl})\n`);
      process.stdout.write(`  Next: write tests in ${result.testPath}/, run \`zond run --api ${opts.name} <test.yaml>\`.\n`);
      process.stdout.write(`  To enable generate/probe/validate-schema, attach a spec: \`zond refresh-api ${opts.name} --spec <path|url>\`.\n`);
    }
    if (result.warnings) for (const w of result.warnings) process.stderr.write(`Warning: ${w}\n`);
  }
  return 0;
}

import type { Command } from "commander";
import { globalJson } from "../resolve.ts";

export function registerAdd(program: Command): void {
  const add = program.command("add").description("Register objects in the workspace");
  add
    .command("api <name>")
    .description("Register an API: from an OpenAPI spec (full toolkit) or just --base-url (run-only mode)")
    .option("--spec <path>", "Path or URL to OpenAPI spec — enables generate/probe/validate-schema")
    .option("--base-url <url>", "Base URL recorded in .env.yaml (required if --spec is omitted)")
    .option("--dir <path>", "Target directory (defaults to apis/<name>/)")
    .option("--force", "Overwrite an existing API with the same name")
    .option("--insecure", "Skip TLS verification when fetching the spec from https")
    .option("--ca <path>", "PEM CA bundle to trust for the spec fetch (adds to public roots; also reads NODE_EXTRA_CA_CERTS) — use instead of --insecure for internal/corp CAs")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (name: string, opts, cmd: Command) => {
      const json = globalJson(cmd);
      if (!opts.spec && !opts.baseUrl) {
        const m = "Provide --spec <path|url> for a full registration, or --base-url <url> for run-only mode.";
        if (json) printJson(jsonError("add-api", [m])); else printError(m);
        process.exitCode = 2;
        return;
      }
      process.exitCode = await addApiCommand({
        name,
        spec: opts.spec,
        baseUrl: opts.baseUrl,
        dir: opts.dir,
        force: opts.force === true,
        insecure: opts.insecure === true,
        caPath: typeof opts.ca === "string" ? opts.ca : undefined,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        json,
      });
    });
}
