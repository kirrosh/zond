/**
 * Probe umbrella.
 *
 * TASK-182 (m-11) introduced `zond probe <class>` as the canonical entry
 * point. TASK-300 (m-13) consolidated the two static-input classes —
 * validation and methods — under `zond probe static [--include …]`; the
 * old `probe validation` / `probe methods` subcommands were removed
 * outright (no deprecation alias).
 *
 * Extracted from program.ts (TASK-190 round 2e) so the registration tree
 * lives next to the action functions it dispatches into.
 */

import type { Command } from "commander";

import { probeStaticCommand, resolveStaticClasses } from "./probe-static.ts";
import { probeMassAssignmentCommand, emitMassAssignmentTemplateCommand } from "./probe-mass-assignment.ts";
import { probeSecurityCommand } from "./probe-security.ts";
import { globalJson, resolveSpecArg, resolveApiEnv } from "../resolve.ts";
import { existsSync } from "fs";
import { parsePositiveInt } from "../argv.ts";
import { printError } from "../output.ts";

/**
 * TASK-233: pick the env file to feed live-probe commands.
 *  - Explicit --env wins (legacy behaviour).
 *  - Otherwise --api <name> derives `apis/<name>/.env.yaml` via the registered
 *    collection's base_dir.
 *  - With `tolerateMissing` (probe security/--dry-run), an absent file is
 *    quietly turned into "no env" — the command will fall back to cwd.
 */
function resolveProbeEnv(
  envFlag: string | undefined,
  apiFlag: string | undefined,
  dbPath: string | undefined,
  opts: { tolerateMissing?: boolean } = {},
): { env: string | undefined } | { error: string } {
  if (envFlag) return { env: envFlag };
  if (!apiFlag) {
    if (opts.tolerateMissing) return { env: undefined };
    return { error: "Missing --env <file> (or pass --api <name> to derive it from apis/<name>/.env.yaml)" };
  }
  const resolved = resolveApiEnv(apiFlag, dbPath);
  if ("error" in resolved) return resolved;
  if (!existsSync(resolved.env)) {
    if (opts.tolerateMissing) return { env: undefined };
    return { error: `Env file not found: ${resolved.env} (derived from --api ${apiFlag})` };
  }
  return { env: resolved.env };
}

function defineProbeStatic(parent: Command, name: string): void {
  parent
    .command(`${name} [spec]`)
    .description(
      "Generate static-input probe suites (validation: bogus types/values; methods: undeclared HTTP methods). Defaults to both; restrict via --include or --exclude.",
    )
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .requiredOption("--output <dir>", "Output directory for generated probe files")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--max-per-endpoint <N>", "Cap negative-input probes per endpoint (default 50)", parsePositiveInt("--max-per-endpoint"))
    .option("--no-cleanup", "Skip emission of follow-up DELETE cleanup steps for mutating probes (use in namespace-isolated test envs)")
    .option("--use-synthetic-parents", "Bake synthetic-by-type values into all path params (legacy). By default, non-attacked path params are emitted as {{name}} and resolved from .env.yaml at run time — needed to reach the leaf validator on nested paths (TASK-135).")
    .option("--include <classes>", "Comma-separated subset of {validation, methods} (default: both)")
    .option("--exclude <classes>", "Comma-separated subset to skip (mutually exclusive with --include)")
    .action(async (specPos: string | undefined, optsArg, cmdRef: Command) => {
      const resolved = resolveSpecArg(specPos, optsArg.api, optsArg.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }

      const r = resolveStaticClasses(optsArg.include, optsArg.exclude);
      if ("error" in r) { printError(r.error); process.exitCode = 2; return; }

      const useReal = optsArg.useSyntheticParents !== true;
      process.exitCode = await probeStaticCommand({
        specPath: resolved.spec,
        output: optsArg.output,
        tag: optsArg.tag,
        maxPerEndpoint: optsArg.maxPerEndpoint,
        noCleanup: optsArg.cleanup === false,
        useRealParents: useReal,
        json: globalJson(cmdRef),
        listTags: optsArg.listTags,
        include: r.classes,
      });
    });
}

function defineProbeMassAssignment(parent: Command, name: string): void {
  parent
    .command(`${name} [spec]`)
    .description(
      "Live probe for mass-assignment / privilege-escalation: classifies POST/PATCH/PUT against suspected extra fields (is_admin, role, account_id, owner_id, user_id, verified, is_system) as rejected (4xx) | accepted-and-applied (HIGH) | accepted-and-ignored (LOW) via follow-up GET",
    )
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--env <file>", "Env YAML with base_url + auth_token (live calls require this; auto-derived from apis/<name>/.env.yaml when --api is given)")
    .option("--output <file>", "Write markdown digest to file (default: stdout)")
    .option("--emit-tests <dir>", "Also emit YAML regression suites locking in safe behaviour for CI")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--no-cleanup", "Skip follow-up DELETE for resources accidentally created by 2xx probes")
    .option("--no-discover", "Disable auto-discovery of path-param fixtures via GET-on-list (TASK-92)")
    .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .option("--emit-template <method:path>", "TASK-146: emit a ready-to-edit YAML probe template for one endpoint (e.g. \"POST:/users\") instead of running the live probe. Pairs `--output <file>` to write to disk (default: stdout). Use to drop down to manual catch-up after INCONCLUSIVE / INCONCLUSIVE-5XX verdicts without copy-pasting boilerplate from the skill.")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }

      // --emit-template short-circuits the live probe.
      if (opts.emitTemplate) {
        process.exitCode = await emitMassAssignmentTemplateCommand({
          specPath: resolved.spec,
          methodPath: opts.emitTemplate,
          output: opts.output,
          json: globalJson(cmd),
        });
        return;
      }

      const envFile = resolveProbeEnv(opts.env, opts.api, opts.db);
      if ("error" in envFile) { printError(envFile.error); process.exitCode = 2; return; }
      process.exitCode = await probeMassAssignmentCommand({
        specPath: resolved.spec,
        env: envFile.env,
        output: opts.output,
        emitTests: opts.emitTests,
        tag: opts.tag,
        listTags: opts.listTags,
        noCleanup: opts.cleanup === false,
        noDiscover: opts.discover === false,
        timeoutMs: opts.timeout,
        overwrite: opts.overwrite === true,
        json: globalJson(cmd),
      });
    });
}

function defineProbeSecurity(parent: Command, name: string): void {
  parent
    .command(`${name} <classes> [spec]`)
    .description(
      "Live security probes (TASK-138): SSRF / CRLF / open-redirect. Detects vulnerable fields by name+format, sends a baseline-OK then per-field payloads, classifies HIGH (5xx or echo) / LOW (2xx no echo) / OK (4xx). <classes> is a comma-separated subset of: ssrf, crlf, open-redirect.",
    )
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--env <file>", "Env YAML with base_url + auth_token (live calls require this; --dry-run can run without; auto-derived from apis/<name>/.env.yaml when --api is given)")
    .option("--output <file>", "Write markdown digest to file (default: stdout)")
    .option("--emit-tests <dir>", "Also emit YAML regression suites locking in safe behaviour for CI")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--no-cleanup", "Skip follow-up DELETE on resources created by baseline / 2xx attacks")
    .option("--isolated", "TASK-264: refuse to attack PUT/PATCH endpoints whose path-params come from .env.yaml — protects seeded fixtures from probe-induced mutation. Lower coverage in exchange for guaranteed fixture safety.")
    .option("--dry-run", "Print which endpoints/fields would be attacked without sending requests")
    .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .action(async (classes: string, specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      // probe-security tolerates a missing env (--dry-run path), so don't
      // fail when --api is given but the env file isn't on disk yet.
      const envFile = resolveProbeEnv(opts.env, opts.api, opts.db, { tolerateMissing: true });
      if ("error" in envFile) { printError(envFile.error); process.exitCode = 2; return; }
      process.exitCode = await probeSecurityCommand({
        specPath: resolved.spec,
        classes,
        env: envFile.env,
        output: opts.output,
        emitTests: opts.emitTests,
        tag: opts.tag,
        listTags: opts.listTags,
        noCleanup: opts.cleanup === false,
        dryRun: opts.dryRun === true,
        timeoutMs: opts.timeout,
        overwrite: opts.overwrite === true,
        json: globalJson(cmd),
        apiName: typeof opts.api === "string" ? opts.api : undefined,
        isolated: opts.isolated === true,
      });
    });
}

export function registerProbes(program: Command): void {
  const probeCmd = program
    .command("probe")
    .description("Run a probe class — pick one of: static, mass-assignment, security");

  defineProbeStatic(probeCmd, "static");
  defineProbeMassAssignment(probeCmd, "mass-assignment");
  defineProbeSecurity(probeCmd, "security");
}
