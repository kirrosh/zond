/**
 * `zond prepare-fixtures` — single-pass fixture-pack command.
 *
 * Deterministically fills `apis/<name>/.env.yaml` with FK ids that can be
 * resolved from list/read endpoints in a single discover pass, and reports
 * which fixtures are still missing so an agent (or the user) can fill the
 * gaps by hand (`fixtures add` / editing `.env.yaml`).
 *
 *   - default                 → single-pass discover (auto-fill FK ids
 *                                from list endpoints).
 *   - --verify / --refresh    → revalidate fixtures via read-by-id.
 *
 * The imperative core (`discoverCommand`) lives in the original module and
 * is still consumed directly by tests. This module only owns the CLI
 * surface.
 */

import type { Command } from "commander";
import { globalJson, resolveSpecArg } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";
import { printError } from "../output.ts";
import { discoverCommand } from "./discover.ts";
import { loadEnvMeta } from "../../core/parser/variables.ts";
import { resolveTimeoutMs } from "../../core/workspace/config.ts";
import { getApi, MISSING_API_MESSAGE } from "../util/api-context.ts";

export function registerPrepareFixtures(program: Command): void {
  program
    .command("prepare-fixtures")
    .description(
      "Auto-fill apis/<name>/.env.yaml in a single discover pass: resolve FK " +
      "ids from list/read endpoints and report which fixtures are still " +
      "missing (fill those by hand via `fixtures add` / editing .env.yaml).",
    )
    // Not `requiredOption` — the value can also come from the program-level
    // --api flag (parsed by program.ts and mirrored into ZOND_API_GLOBAL),
    // ZOND_API env, or .zond/current-api. Commander would otherwise reject
    // `zond prepare-fixtures --api foo` because it routes `--api` to the
    // global option, leaving the subcommand's opts.api undefined.
    .option("--api <name>", "Registered API to prepare (apis/<name>/.env.yaml). Falls back to ZOND_API / .zond/current-api.")
    .option("--db <path>", "Path to SQLite database file")
    .option("--api-dir <path>", "Override apis/<name>/ root (defaults to the collection's base_dir)")
    .option("--env <path>", "Override .env.yaml path (defaults to <api-dir>/.env.yaml)")
    .option("--apply", "Write discovered values to .env.yaml (with .env.yaml.bak backup). Default: dry-run.")
    .option("--verify", "GET each fixture's read-by-id endpoint and classify live/stale/unknown. Combine with --apply (or use --refresh) to drop stale fixtures and re-resolve them. (TASK-281)")
    .option("--refresh", "Shortcut for --verify --apply. (TASK-281)")
    .option("--timeout <ms>", "Per-request timeout in ms (overrides apis/<name>/.env.yaml `timeoutMs` and zond.config.yml `defaults.timeout_ms`; default 30000)", parsePositiveInt("--timeout"))
    .action(async (opts, cmd: Command) => {
      // ARV-53: --api resolution lives in cli/util/api-context.ts —
      // local opt > ancestor opt > ZOND_API_GLOBAL/ZOND_API/.zond/current-api.
      const apiName = getApi(cmd, opts);
      if (!apiName) {
        printError(MISSING_API_MESSAGE);
        process.exitCode = 2;
        return;
      }
      opts.api = apiName;

      const refresh = opts.refresh === true;
      const verify = opts.verify === true || refresh;

      const resolved = resolveSpecArg(undefined, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }

      let apiDir = opts.apiDir as string | undefined;
      if (!apiDir) {
        try {
          getDb(opts.db);
          const col = findCollectionByNameOrId(opts.api);
          apiDir = col?.base_dir ?? `apis/${opts.api}`;
        } catch {
          apiDir = `apis/${opts.api}`;
        }
      }

      let envTimeout: number | undefined;
      try {
        envTimeout = (await loadEnvMeta(undefined, apiDir)).timeoutMs;
      } catch { /* meta is best-effort */ }
      const timeoutMs = resolveTimeoutMs(opts.timeout, envTimeout);

      process.exitCode = await discoverCommand({
        specPath: resolved.spec,
        apiDir,
        envPath: opts.env,
        apply: opts.apply === true || refresh,
        verify,
        timeoutMs,
        json: globalJson(cmd),
        // ARV-205 (R10/F6, R13/F19, R14): single-pass branch also delegates,
        // so surface the user-facing command name in the JSON envelope.
        commandName: "prepare-fixtures",
      });
    });
}
