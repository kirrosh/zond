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
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";

export interface AddApiOptions {
  name: string;
  spec: string;
  baseUrl?: string;
  dir?: string;
  force?: boolean;
  insecure?: boolean;
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
    });
  } catch (err) {
    const m = (err as Error).message;
    if (opts.json) printJson(jsonError("add-api", [m])); else printError(m);
    return 2;
  }

  if (opts.json) {
    printJson(jsonOk("add-api", {
      api: opts.name,
      collectionId: result.collectionId,
      baseDir: result.baseDir,
      testPath: result.testPath,
      endpoints: result.specEndpoints,
      artifacts: ["spec.json", ".api-catalog.yaml", ".api-resources.yaml", ".api-fixtures.yaml"],
    }, result.warnings));
  } else {
    printSuccess(`Registered API '${opts.name}' at ${result.baseDir} (${result.specEndpoints} endpoints)`);
    process.stdout.write(`  Artifacts: spec.json + .api-catalog.yaml + .api-resources.yaml + .api-fixtures.yaml\n`);
    process.stdout.write(`  Next: run \`zond doctor --api ${opts.name}\` to see required fixtures.\n`);
    if (result.warnings) for (const w of result.warnings) process.stderr.write(`Warning: ${w}\n`);
  }
  return 0;
}
