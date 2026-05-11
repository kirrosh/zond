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
import { SECURITY_CLASSES } from "../../core/probe/security-probe.ts";
import { globalJson, resolveSpecArg, resolveApiEnv, resolveApiCollection } from "../resolve.ts";
import { getApi } from "../util/api-context.ts";
import { existsSync } from "fs";
import { join, dirname } from "node:path";
import { parsePositiveInt } from "../argv.ts";
import { printError } from "../output.ts";
import { loadEnvMeta } from "../../core/parser/variables.ts";
import { resolveTimeoutMs } from "../../core/workspace/config.ts";

/**
 * ARV-53: thin wrapper kept for the existing call-sites — the real chain
 * (local → ancestor → ZOND_API_GLOBAL/ZOND_API/.zond/current-api) lives in
 * cli/util/api-context.ts. `resolveProbeApi` predates that helper (ARV-33).
 */
export function resolveProbeApi(
  optsApi: string | undefined,
  cmd: { opts?: () => Record<string, unknown>; parent?: { opts(): Record<string, unknown> } | null } | undefined,
): string | undefined {
  // Adapt the loose mock shape used at the old call-sites to CommandLike.
  if (cmd === undefined) {
    return getApi(undefined, { api: optsApi });
  }
  const adapted = {
    opts: () => (typeof cmd.opts === "function" ? cmd.opts() : {}),
    parent: cmd.parent ?? null,
  };
  return getApi(adapted, { api: optsApi });
}

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

/**
 * Resolve `--timeout` for live-probe commands. Reads the per-API
 * `.env.yaml` `timeoutMs:` meta when `--api` is set (or when the env
 * file is on disk), then falls back to workspace `defaults.timeout_ms`.
 */
async function resolveProbeTimeout(
  cliFlag: number | undefined,
  apiFlag: string | undefined,
  envFile: string | undefined,
): Promise<number> {
  let envTimeout: number | undefined;
  try {
    if (apiFlag) {
      const meta = await loadEnvMeta(undefined, `apis/${apiFlag}`);
      envTimeout = meta.timeoutMs;
    } else if (envFile) {
      const meta = await loadEnvMeta(undefined, dirname(envFile));
      envTimeout = meta.timeoutMs;
    }
  } catch { /* meta is best-effort */ }
  return resolveTimeoutMs(cliFlag, envTimeout);
}

function defineProbeStatic(parent: Command, name: string): void {
  parent
    .command(`${name} [spec]`)
    .description(
      "Generate static-input probe suites (validation: bogus types/values; methods: undeclared HTTP methods). Defaults to both; restrict via --include or --exclude.",
    )
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    // ARV-30: --output is optional when --api (or current-api) is set —
    // probes land in apis/<name>/probes/static/ alongside generate's tests/.
    // Required only when probing a bare spec with no registered collection.
    .option("--output <dir>", "Output directory for generated probe files (default: apis/<api>/probes/static when --api / current-api is set)")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--max-per-endpoint <N>", "Cap negative-input probes per endpoint (default 50)", parsePositiveInt("--max-per-endpoint"))
    .option("--no-cleanup", "Skip emission of follow-up DELETE cleanup steps for mutating probes (use in namespace-isolated test envs)")
    .option("--use-synthetic-parents", "Bake synthetic-by-type values into all path params (legacy). By default, non-attacked path params are emitted as {{name}} and resolved from .env.yaml at run time — needed to reach the leaf validator on nested paths (TASK-135).")
    .option("--include <classes>", "Comma-separated subset of {validation, methods} (default: both)")
    .option("--exclude <classes>", "Comma-separated subset to skip (mutually exclusive with --include)")
    .action(async (specPos: string | undefined, optsArg, cmdRef: Command) => {
      // ARV-33: see resolveProbeApi — keep the chain consistent with the
      // sibling subcommands (mass-assignment, security).
      const apiName = resolveProbeApi(optsArg.api, cmdRef);
      const resolved = resolveSpecArg(specPos, apiName, optsArg.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }

      const r = resolveStaticClasses(optsArg.include, optsArg.exclude);
      if ("error" in r) { printError(r.error); process.exitCode = 2; return; }

      // ARV-30: derive --output from the registered API's base_dir when the
      // user didn't pass one. Bare-spec invocations (positional only, no --api,
      // no current-api) still must pass --output explicitly.
      let outputDir: string | undefined = optsArg.output;
      if (!outputDir && apiName) {
        const col = resolveApiCollection(apiName, optsArg.db);
        if (!("error" in col) && col.baseDir) outputDir = join(col.baseDir, "probes", "static");
      }
      if (!outputDir) {
        printError("--output <dir> is required when no --api / current-api can resolve apis/<name>/probes/static.");
        process.exitCode = 2;
        return;
      }

      const useReal = optsArg.useSyntheticParents !== true;
      process.exitCode = await probeStaticCommand({
        specPath: resolved.spec,
        output: outputDir,
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
    .option("--dry-run", "Print which endpoints/fields would be attacked without sending requests (m-17 ARV-52)")
    .option(
      "--include <selector>",
      "Filter operations (m-15 ARV-9 grammar: path:/users/.* | tag:Webhooks | method:POST,PATCH | operation-id:create.*). Repeatable.",
      (v: string, prev: string[] = []) => prev.concat(v),
      [] as string[],
    )
    .option(
      "--exclude <selector>",
      "Drop operations matching <selector>. Repeatable. Same grammar as --include.",
      (v: string, prev: string[] = []) => prev.concat(v),
      [] as string[],
    )
    .option("--timeout <ms>", "Per-request timeout in ms (overrides apis/<name>/.env.yaml `timeoutMs` and zond.config.yml `defaults.timeout_ms`; default 30000)", parsePositiveInt("--timeout"))
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .option("--report <format>", "Format for --output / non-json stdout (markdown|json). --json envelope is always structured (m-17 ARV-51). Default markdown.", "markdown")
    .option("--emit-template <method:path>", "TASK-146: emit a ready-to-edit YAML probe template for one endpoint (e.g. \"POST:/users\") instead of running the live probe. Pairs `--output <file>` to write to disk (default: stdout). Use to drop down to manual catch-up after INCONCLUSIVE / INCONCLUSIVE-5XX verdicts without copy-pasting boilerplate from the skill.")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      // ARV-33: resolve --api via the same fallback chain as prepare-fixtures /
      // ARV-29 — direct opts, then parent opts, then ZOND_API_GLOBAL /
      // .zond/current-api. Otherwise `zond probe mass-assignment --api foo`
      // hits commander's global-option absorption and `opts.api` is empty.
      const apiName = resolveProbeApi(opts.api, cmd);
      const resolved = resolveSpecArg(specPos, apiName, opts.db);
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

      // m-17 / ARV-52 + ARV-58: dry-run and list-tags paths tolerate a
      // missing env file the way probe-security does — the user wants
      // to inspect the plan / available tags, not hit a live API.
      const envFile = resolveProbeEnv(opts.env, apiName, opts.db, {
        tolerateMissing: opts.dryRun === true || opts.listTags === true,
      });
      if ("error" in envFile) { printError(envFile.error); process.exitCode = 2; return; }
      const timeoutMs = await resolveProbeTimeout(opts.timeout, apiName, envFile.env);
      const reportFmt = opts.report === "json" ? "json" : "markdown";
      process.exitCode = await probeMassAssignmentCommand({
        specPath: resolved.spec,
        env: envFile.env,
        output: opts.output,
        emitTests: opts.emitTests,
        tag: opts.tag,
        listTags: opts.listTags,
        noCleanup: opts.cleanup === false,
        noDiscover: opts.discover === false,
        timeoutMs,
        overwrite: opts.overwrite === true,
        json: globalJson(cmd),
        dryRun: opts.dryRun === true,
        include: Array.isArray(opts.include) && opts.include.length > 0 ? opts.include : undefined,
        exclude: Array.isArray(opts.exclude) && opts.exclude.length > 0 ? opts.exclude : undefined,
        report: reportFmt,
      });
    });
}

function defineProbeSecurity(parent: Command, name: string): void {
  parent
    // ARV-36: classes is technically required but kept optional in commander
    // so the missing-arg branch can produce the same actionable list of
    // available classes that --unknown-class already prints (data already in
    // SECURITY_CLASSES — no reason to force a --help read for first-time users).
    .command(`${name} [classes] [spec]`)
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
    .option(
      "--include <selector>",
      "Filter operations (m-15 ARV-9 grammar: path:/users/.* | tag:Webhooks | method:POST,PATCH). Repeatable.",
      (v: string, prev: string[] = []) => prev.concat(v),
      [] as string[],
    )
    .option(
      "--exclude <selector>",
      "Drop operations matching <selector>. Repeatable.",
      (v: string, prev: string[] = []) => prev.concat(v),
      [] as string[],
    )
    .option("--dry-run", "Print which endpoints/fields would be attacked without sending requests")
    .option("--timeout <ms>", "Per-request timeout in ms (overrides apis/<name>/.env.yaml `timeoutMs` and zond.config.yml `defaults.timeout_ms`; default 30000)", parsePositiveInt("--timeout"))
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .option("--report <format>", "Format for --output / non-json stdout (markdown|json). --json envelope is always structured (m-17 ARV-51). Default markdown.", "markdown")
    .action(async (classes: string | undefined, specPos: string | undefined, opts, cmd: Command) => {
      // ARV-36: missing-arg path should list the available classes (parity
      // with the unknown-class error). Commander's default `missing required
      // argument` doesn't include them; once we made <classes> optional, we
      // surface the same hint here.
      if (typeof classes !== "string" || classes.length === 0) {
        printError(`Missing required argument <classes>. Available: ${SECURITY_CLASSES.join(", ")}`);
        process.exitCode = 2;
        return;
      }
      // ARV-33: same fallback chain as mass-assignment so `zond probe security
      // ssrf --api foo` doesn't fall through to a confusing "base_url is
      // required" when commander absorbs --api at the global scope.
      const apiName = resolveProbeApi(opts.api, cmd);
      const resolved = resolveSpecArg(specPos, apiName, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      // probe-security tolerates a missing env (--dry-run path), so don't
      // fail when --api is given but the env file isn't on disk yet.
      const envFile = resolveProbeEnv(opts.env, apiName, opts.db, { tolerateMissing: true });
      if ("error" in envFile) { printError(envFile.error); process.exitCode = 2; return; }
      const timeoutMs = await resolveProbeTimeout(opts.timeout, apiName, envFile.env);
      const reportFmt = opts.report === "json" ? "json" : "markdown";
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
        timeoutMs,
        overwrite: opts.overwrite === true,
        json: globalJson(cmd),
        apiName,
        isolated: opts.isolated === true,
        report: reportFmt,
        include: Array.isArray(opts.include) && opts.include.length > 0 ? opts.include : undefined,
        exclude: Array.isArray(opts.exclude) && opts.exclude.length > 0 ? opts.exclude : undefined,
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
