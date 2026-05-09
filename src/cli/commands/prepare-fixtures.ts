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

export function registerPrepareFixtures(program: Command): void {
  program
    .command("prepare-fixtures")
    .description(
      "Auto-fill apis/<name>/.env.yaml — single-pass discover by default, " +
      "or `--cascade` for the multi-pass discover+seed flow (replaces the legacy " +
      "`discover` and `bootstrap` commands; TASK-299).",
    )
    .requiredOption("--api <name>", "Registered API to prepare (apis/<name>/.env.yaml)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--api-dir <path>", "Override apis/<name>/ root (defaults to the collection's base_dir)")
    .option("--env <path>", "Override .env.yaml path (defaults to <api-dir>/.env.yaml)")
    .option("--apply", "Write discovered values to .env.yaml (with .env.yaml.bak backup). Default: dry-run.")
    .option("--cascade", "Multi-pass cascade discover (former `bootstrap`). Required for --seed / --force / --max-passes.")
    .option("--seed", "POST-create resources when discover can't find an existing record (implies --cascade)")
    .option("--force", "Re-discover/re-seed even if a fixture is already filled (cascade only)")
    .option("--verify", "GET each fixture's read-by-id endpoint and classify live/stale/unknown (single-pass only). Combine with --apply (or use --refresh) to drop stale fixtures and re-resolve them. (TASK-281)")
    .option("--refresh", "Shortcut for --verify --apply (single-pass only). (TASK-281)")
    .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
    .option("--max-passes <n>", "Cap on cascade passes (default 8; cascade only)", parsePositiveInt("--max-passes"))
    .action(async (opts, cmd: Command) => {
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

      if (cascade) {
        process.exitCode = await bootstrapCommand({
          specPath: resolved.spec,
          apiDir,
          envPath: opts.env,
          apply: opts.apply === true,
          seed: opts.seed === true,
          force: opts.force === true,
          timeoutMs: opts.timeout,
          maxPasses: opts.maxPasses,
          json: globalJson(cmd),
        });
        return;
      }

      process.exitCode = await discoverCommand({
        specPath: resolved.spec,
        apiDir,
        envPath: opts.env,
        apply: opts.apply === true || refresh,
        verify,
        timeoutMs: opts.timeout,
        json: globalJson(cmd),
      });
    });
}
