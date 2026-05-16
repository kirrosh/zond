/**
 * `zond prepare-fixtures` — unified fixture-pack command.
 *
 * Consolidates the former `discover` and `bootstrap` (TASK-299, m-13 D):
 *
 *   - default                 → single-pass discover (auto-fill FK ids
 *                                from list endpoints).
 *   - --cascade               → multi-pass cascade (former bootstrap).
 *   - --seed                  → cascade + POST-create when discover misses
 *                                (implies --cascade).
 *   - --verify / --refresh    → revalidate fixtures via read-by-id
 *                                (former `discover --verify/--refresh`).
 *
 * The imperative cores (`discoverCommand`, `bootstrapCommand`) live in
 * the original modules and are still consumed directly by tests. This
 * module only owns the CLI surface.
 */

import type { Command } from "commander";
import { globalJson, resolveSpecArg } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";
import { printError } from "../output.ts";
import { discoverCommand } from "./discover.ts";
import { bootstrapCommand } from "./bootstrap.ts";
import { loadEnvMeta } from "../../core/parser/variables.ts";
import { resolveTimeoutMs } from "../../core/workspace/config.ts";
import { getApi, MISSING_API_MESSAGE } from "../util/api-context.ts";

export function registerPrepareFixtures(program: Command): void {
  program
    .command("prepare-fixtures")
    .description(
      "Auto-fill apis/<name>/.env.yaml — single-pass discover by default, " +
      "or `--cascade` for the multi-pass discover+seed flow (replaces the legacy " +
      "`discover` and `bootstrap` commands; TASK-299).",
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
    .option("--cascade", "Multi-pass cascade discover (former `bootstrap`). Required for --seed / --force / --max-passes.")
    .option("--seed", "POST-create resources when discover can't find an existing record (implies --cascade)")
    .option("--force", "Re-discover/re-seed even if a fixture is already filled (cascade only)")
    .option("--verify", "GET each fixture's read-by-id endpoint and classify live/stale/unknown (single-pass only). Combine with --apply (or use --refresh) to drop stale fixtures and re-resolve them. (TASK-281)")
    .option("--refresh", "Shortcut for --verify --apply (single-pass only). (TASK-281)")
    .option("--timeout <ms>", "Per-request timeout in ms (overrides apis/<name>/.env.yaml `timeoutMs` and zond.config.yml `defaults.timeout_ms`; default 30000)", parsePositiveInt("--timeout"))
    .option("--max-passes <n>", "Cap on cascade passes (default 8; cascade only)", parsePositiveInt("--max-passes"))
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

      const cascade = opts.cascade === true || opts.seed === true;
      const refresh = opts.refresh === true;
      const verify = opts.verify === true || refresh;

      // Flag combos that don't make sense — fail fast with a clear hint.
      if (cascade && verify) {
        printError("--verify / --refresh are single-pass options; drop --cascade/--seed or drop --verify.");
        process.exitCode = 2;
        return;
      }
      if (!cascade && (opts.force === true || typeof opts.maxPasses === "number")) {
        printError("--force / --max-passes only apply with --cascade (or --seed).");
        process.exitCode = 2;
        return;
      }

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

      if (cascade) {
        process.exitCode = await bootstrapCommand({
          specPath: resolved.spec,
          apiDir,
          envPath: opts.env,
          apply: opts.apply === true,
          seed: opts.seed === true,
          force: opts.force === true,
          timeoutMs,
          maxPasses: opts.maxPasses,
          json: globalJson(cmd),
          // ARV-205 (R10/F6, R13/F19): surface the user-facing command name
          // in the JSON envelope. Without this the user sees command="bootstrap"
          // even though they typed `zond prepare-fixtures …`.
          commandName: "prepare-fixtures",
        });
        return;
      }

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
