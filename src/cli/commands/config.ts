/**
 * `zond config validate` (ARV-283 AC#2) — dedicated entry point that
 * runs `loadSeverityConfig` against the current workspace + API and
 * surfaces validation errors with file:keypath:message precision. Lets
 * users smoke-test their `.zond/severity.yaml` / `apis/<name>/.zond-
 * severity.yaml` without having to spin up a `checks run` that already
 * dies on the same failure as a side-effect.
 */
import type { Command } from "commander";

import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { loadSeverityConfig, SeverityConfigError } from "../../core/severity/loader.ts";
import { getApi } from "../util/api-context.ts";
import { globalJson } from "../resolve.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";

interface ValidateOutput {
  workspaceRoot: string;
  api?: string;
  checksOverridden: number;
  suppressionsLoaded: number;
}

function defineValidate(parent: Command): void {
  parent
    .command("validate")
    .description(
      "Validate .zond/severity.yaml (workspace) and apis/<name>/.zond-severity.yaml (per-API). Exits 0 when both load cleanly (or are absent), 1 on schema errors.",
    )
    .option("--api <name>", "API name for the per-API config lookup. Falls back to ZOND_API / .zond/current-api.")
    .action(async (opts, cmd: Command) => {
      const ws = findWorkspaceRoot();
      const api = getApi(cmd, opts) ?? undefined;
      const json = globalJson(cmd);

      try {
        const merged = loadSeverityConfig({ workspaceRoot: ws.root, api });
        const data: ValidateOutput = {
          workspaceRoot: ws.root,
          api,
          checksOverridden: Object.keys(merged.checks).length,
          suppressionsLoaded: merged.suppressions.length,
        };
        if (json) {
          printJson(jsonOk("config validate", data));
        } else {
          printSuccess("severity config OK");
          if (api) console.log(`  api: ${api}`);
          console.log(`  checks overridden: ${data.checksOverridden}`);
          console.log(`  suppressions: ${data.suppressionsLoaded}`);
        }
        process.exitCode = 0;
      } catch (err) {
        if (err instanceof SeverityConfigError) {
          if (json) {
            const errors = err.errors.map((e) => ({
              code: "argument_invalid" as const,
              message: `${e.source}: ${e.keyPath}: ${e.message}`,
              details: { file: e.source, keyPath: e.keyPath, reason: e.message },
            }));
            printJson(jsonError("config validate", errors, [], 1));
          } else {
            printError("severity config invalid:");
            for (const e of err.errors) {
              console.error(`  ${e.source}: ${e.keyPath}: ${e.message}`);
            }
          }
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}

export function registerConfig(program: Command): void {
  const cmd = program
    .command("config")
    .description("Inspect and validate zond workspace configuration");
  defineValidate(cmd);
}
