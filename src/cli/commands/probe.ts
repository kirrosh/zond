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

// ARV-129: action handlers relocated from top-level commands/probe-*.ts
// into commands/probe/ — the orchestrator (this file) stays at top level,
// the per-subcommand modules are no longer mistaken for siblings.
import { probeStaticCommand, resolveStaticClasses } from "./probe/static.ts";
import { probeMassAssignmentCommand, emitMassAssignmentTemplateCommand } from "./probe/mass-assignment.ts";
import { probeSecurityCommand } from "./probe/security.ts";
import { probeWebhooksCommand } from "./probe/webhooks.ts";
import { SECURITY_CLASSES } from "../../core/probe/security-probe.ts";
import { globalJson, resolveSpecArg, resolveApiEnv, resolveApiCollection } from "../resolve.ts";
import { getApi } from "../util/api-context.ts";
import { existsSync } from "fs";
import { join, dirname } from "node:path";
import { parsePositiveInt } from "../argv.ts";
import { printError, printWarning } from "../output.ts";
import { SAFE_HELP, LIVE_HELP, resolveLive } from "../safe-live.ts";
import { jsonError, printJson } from "../json-envelope.ts";
import { loadEnvMeta } from "../../core/parser/variables.ts";
import { resolveTimeoutMs } from "../../core/workspace/config.ts";
import { resolveOutput, OutputSpecError, type OutputSpec, type ResolvedOutput } from "../../core/output/index.ts";

/**
 * ARV-119 (m-19): typed declaration of the `--report` / `--output`
 * surface shared by the live-probe subcommands (mass-assignment +
 * security). Both render a markdown digest by default, with `--report
 * json` switching to a structured JSON file body. `--output <path>`
 * routes the rendered body to a file; without it the body lands on
 * stdout (when `--json` is not set — see m-17 / ARV-51: the `--json`
 * envelope is a separate channel that wraps the structured result).
 *
 * `probe static` is *not* on this spec — its `--output` is a directory
 * where YAML probe suites are written, semantics not output-format.
 */
export const PROBE_OUTPUT_SPEC: OutputSpec<unknown> = {
  command: "probe",
  defaultFormat: "markdown",
  formats: {
    markdown: { defaultChannel: "stdout", description: "Human-readable digest (default)" },
    json:     { defaultChannel: "stdout", description: "Structured JSON body — same shape as the --json envelope's data." },
  },
};

/**
 * ARV-119: shared `--report` / `--output` / `--overwrite` option set
 * for the two live-probe subcommands. Resolution goes through
 * `resolveProbeOutputFlags` so unknown formats and mutually-exclusive
 * combinations surface the same error for both subcommands instead of
 * each one reimplementing the validation.
 */
function addProbeReportOutputOptions(cmd: Command): Command {
  return cmd
    .option("--output <file>", "ARV-119: write the rendered report to this file (default: stdout). Pairs with --report to pick the format.")
    .option(
      "--report <format>",
      "ARV-119: format for --output / non-json stdout (markdown|json). Default markdown. The --json envelope (m-17 ARV-51) is a separate channel and is always structured.",
      "markdown",
    )
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)");
}

interface ProbeReportOutputOpts {
  report?: string;
  output?: string;
}

/**
 * ARV-119: resolve --report / --output through PROBE_OUTPUT_SPEC. On
 * unknown format / mutual-exclusion violation, prints the consistent
 * error (envelope when --json) and returns null — caller exits 2.
 */
function resolveProbeOutputFlags(
  command: string,
  opts: ProbeReportOutputOpts,
  json: boolean,
): { resolved: ResolvedOutput; report: "markdown" | "json"; output?: string } | null {
  let resolved: ResolvedOutput;
  try {
    resolved = resolveOutput(PROBE_OUTPUT_SPEC, { report: opts.report, output: opts.output });
  } catch (err) {
    if (err instanceof OutputSpecError) {
      if (json) printJson(jsonError(command, [err.message]));
      else printError(err.message);
      return null;
    }
    throw err;
  }
  const report: "markdown" | "json" = resolved.format === "json" ? "json" : "markdown";
  const output = resolved.channel === "file" ? resolved.path : undefined;
  return { resolved, report, output };
}

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
    // ARV-225: probe static --include is a CLASS LIST ({validation, methods}),
    // while sibling commands (probe security, probe mass-assignment, checks
    // run) use SELECTOR grammar (path:/method:/tag:/operation-id:). Rename the
    // canonical flag to --include-class / --exclude-class for clarity; keep
    // --include / --exclude as deprecated aliases (warn on use).
    .option("--include-class <classes>", "Comma-separated subset of {validation, methods} (default: both)")
    .option("--exclude-class <classes>", "Comma-separated subset to skip (mutually exclusive with --include-class)")
    .option("--include <classes>", "[deprecated, use --include-class] Comma-separated subset of {validation, methods}")
    .option("--exclude <classes>", "[deprecated, use --exclude-class] Comma-separated subset to skip")
    // ARV-299: static only *generates* probe suites (it never sends live
    // traffic), so it is always safe. The flags exist for vocabulary parity
    // with the sibling subcommands; --live is a no-op here and says so.
    .option("--safe", SAFE_HELP)
    .option("--live", LIVE_HELP)
    .action(async (specPos: string | undefined, optsArg, cmdRef: Command) => {
      if (optsArg.live === true) {
        printWarning("probe static only generates suites and never sends live traffic — --safe/--live have no effect here. Run the emitted suites with `zond run … --live` to execute them.");
      }
      // ARV-33: see resolveProbeApi — keep the chain consistent with the
      // sibling subcommands (mass-assignment, security).
      const apiName = resolveProbeApi(optsArg.api, cmdRef);
      const resolved = resolveSpecArg(specPos, apiName, optsArg.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }

      // ARV-225: prefer --include-class / --exclude-class. Fall back to
      // --include / --exclude with a one-line stderr deprecation note —
      // these are the legacy names that collide semantically with the
      // selector --include on sibling commands.
      let includeClasses: string | undefined = optsArg.includeClass;
      let excludeClasses: string | undefined = optsArg.excludeClass;
      if (!includeClasses && optsArg.include) {
        process.stderr.write(
          "Warning: `probe static --include <classes>` is deprecated (class-list, not a selector — collides with probe security / checks run). Use --include-class.\n",
        );
        includeClasses = optsArg.include;
      }
      if (!excludeClasses && optsArg.exclude) {
        process.stderr.write(
          "Warning: `probe static --exclude <classes>` is deprecated. Use --exclude-class.\n",
        );
        excludeClasses = optsArg.exclude;
      }
      const r = resolveStaticClasses(includeClasses, excludeClasses);
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
  const sub = parent
    .command(`${name} [spec]`)
    .description(
      "Live probe for mass-assignment / privilege-escalation: classifies POST/PATCH/PUT against suspected extra fields (is_admin, role, account_id, owner_id, user_id, verified, is_system) as rejected (4xx) | accepted-and-applied (HIGH) | accepted-and-ignored (LOW) via follow-up GET",
    )
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--env <file>", "Env YAML with base_url + auth_token (live calls require this; auto-derived from apis/<name>/.env.yaml when --api is given)")
    .option("--emit-tests <dir>", "Also emit YAML regression suites locking in safe behaviour for CI")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--no-cleanup", "Skip follow-up DELETE for resources accidentally created by 2xx probes")
    .option("--no-discover", "Disable auto-discovery of path-param fixtures via GET-on-list (TASK-92)")
    .option("--dry-run", "Print which endpoints/fields would be attacked without sending requests (m-17 ARV-52). Equivalent to the default --safe mode.")
    .option("--safe", SAFE_HELP)
    .option("--live", LIVE_HELP)
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
    .option(
      "--verbose",
      "ARV-252: surface INFO-severity inconclusive verdicts (absent-but-unverifiable). Silently-ignored verdicts (correct framework behaviour) stay hidden even with this flag — they're never finding-worthy.",
    )
    .option(
      "--suspect-field <name=value>",
      "ARV-252: extend the curated suspect-fields list (is_admin, role, owner_id, …) with a custom field. Repeatable. Full per-api spec-extension support tracked in ARV-189.",
      (v: string, prev: string[] = []) => prev.concat(v),
      [] as string[],
    )
    .option("--emit-template <method:path>", "TASK-146: emit a ready-to-edit YAML probe template for one endpoint (e.g. \"POST:/users\") instead of running the live probe. Pairs `--output <file>` to write to disk (default: stdout). Use to drop down to manual catch-up after INCONCLUSIVE / INCONCLUSIVE-5XX verdicts without copy-pasting boilerplate from the skill.")
    .option("--max-endpoints <n>", "ARV-302: cap the number of endpoints probed in this run (after --include / --exclude / --tag filters). Used by `zond audit --budget` to keep probe stages inside a wall-clock budget instead of unbounded scanning.", parsePositiveInt("--max-endpoints"));
  addProbeReportOutputOptions(sub);
  sub.action(async (specPos: string | undefined, opts, cmd: Command) => {
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

      // ARV-299: safe (default) → plan only, no live mutating traffic. The
      // proven --dry-run path IS the safe path, so we just force it on when
      // --live is absent (and say so, unless the user already asked for a
      // dry-run explicitly).
      const live = resolveLive(opts);
      const effectiveDryRun = opts.dryRun === true || !live;
      if (!live && opts.dryRun !== true && !opts.listTags) {
        printWarning("probe mass-assignment: safe mode (default) — planning only, no live attack traffic. Re-run with --live against a throwaway/sandbox account to send probes.");
      }
      // m-17 / ARV-52 + ARV-58: dry-run and list-tags paths tolerate a
      // missing env file the way probe-security does — the user wants
      // to inspect the plan / available tags, not hit a live API.
      const envFile = resolveProbeEnv(opts.env, apiName, opts.db, {
        tolerateMissing: effectiveDryRun || opts.listTags === true,
      });
      if ("error" in envFile) { printError(envFile.error); process.exitCode = 2; return; }
      const timeoutMs = await resolveProbeTimeout(opts.timeout, apiName, envFile.env);
      const json = globalJson(cmd);
      const rep = resolveProbeOutputFlags("probe-mass-assignment", opts, json);
      if (!rep) { process.exitCode = 2; return; }
      process.exitCode = await probeMassAssignmentCommand({
        specPath: resolved.spec,
        env: envFile.env,
        apiName,
        output: rep.output,
        emitTests: opts.emitTests,
        tag: opts.tag,
        listTags: opts.listTags,
        noCleanup: opts.cleanup === false,
        noDiscover: opts.discover === false,
        timeoutMs,
        overwrite: opts.overwrite === true,
        json,
        dryRun: effectiveDryRun,
        include: Array.isArray(opts.include) && opts.include.length > 0 ? opts.include : undefined,
        exclude: Array.isArray(opts.exclude) && opts.exclude.length > 0 ? opts.exclude : undefined,
        report: rep.report,
        verbose: opts.verbose === true,
        suspectField: Array.isArray(opts.suspectField) && opts.suspectField.length > 0 ? opts.suspectField : undefined,
        maxEndpoints: typeof opts.maxEndpoints === "number" ? opts.maxEndpoints : undefined,
      });
    });
}

function defineProbeSecurity(parent: Command, name: string): void {
  const sub = parent
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
    .option("--emit-tests <dir>", "Also emit YAML regression suites locking in safe behaviour for CI")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--no-cleanup", "Skip follow-up DELETE on resources created by baseline / 2xx attacks")
    .option("--isolated", "TASK-264: refuse to attack PUT/PATCH endpoints whose path-params come from .env.yaml — protects seeded fixtures from probe-induced mutation. Lower coverage in exchange for guaranteed fixture safety.")
    .option("--allow-leaks", "ARV-140: attack POST endpoints even when the spec has no DELETE counterpart. Default: skip — without DELETE there is no cleanup path and resources accumulate in the target tenant (round-01/02 Sentry left 18 manual orphans). Use when you've vetted manual cleanup or are in a throwaway env.")
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
    .option("--dry-run", "Print which endpoints/fields would be attacked without sending requests. Equivalent to the default --safe mode.")
    .option("--safe", SAFE_HELP)
    .option("--live", LIVE_HELP)
    .option("--timeout <ms>", "Per-request timeout in ms (overrides apis/<name>/.env.yaml `timeoutMs` and zond.config.yml `defaults.timeout_ms`; default 30000)", parsePositiveInt("--timeout"))
    .option(
      "--verbose",
      "ARV-253: surface INFO-severity findings (sanitization-signal-only, e.g. CRLF accepted but no reflection observed). Default hides them — they're single-signal proof with no exploit pathway.",
    )
    .option("--max-endpoints <n>", "ARV-302: cap the number of endpoints probed in this run (after --include / --exclude / --tag filters). Used by `zond audit --budget` to keep probe stages inside a wall-clock budget instead of unbounded scanning.", parsePositiveInt("--max-endpoints"));
  addProbeReportOutputOptions(sub);
  sub.action(async (classes: string | undefined, specPos: string | undefined, opts, cmd: Command) => {
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
      // ARV-299: safe (default) forces plan-only; live attack traffic needs --live.
      const live = resolveLive(opts);
      const effectiveDryRun = opts.dryRun === true || !live;
      if (!live && opts.dryRun !== true && !opts.listTags) {
        printWarning("probe security: safe mode (default) — planning only, no live attack traffic. Re-run with --live against a throwaway/sandbox account to send probes.");
      }
      // probe-security tolerates a missing env (--dry-run path), so don't
      // fail when --api is given but the env file isn't on disk yet.
      const envFile = resolveProbeEnv(opts.env, apiName, opts.db, { tolerateMissing: true });
      if ("error" in envFile) { printError(envFile.error); process.exitCode = 2; return; }
      const timeoutMs = await resolveProbeTimeout(opts.timeout, apiName, envFile.env);
      const json = globalJson(cmd);
      const rep = resolveProbeOutputFlags("probe-security", opts, json);
      if (!rep) { process.exitCode = 2; return; }
      process.exitCode = await probeSecurityCommand({
        specPath: resolved.spec,
        classes,
        env: envFile.env,
        output: rep.output,
        emitTests: opts.emitTests,
        tag: opts.tag,
        listTags: opts.listTags,
        noCleanup: opts.cleanup === false,
        dryRun: effectiveDryRun,
        timeoutMs,
        overwrite: opts.overwrite === true,
        json,
        apiName,
        isolated: opts.isolated === true,
        allowLeaks: opts.allowLeaks === true,
        report: rep.report,
        include: Array.isArray(opts.include) && opts.include.length > 0 ? opts.include : undefined,
        exclude: Array.isArray(opts.exclude) && opts.exclude.length > 0 ? opts.exclude : undefined,
        verbose: opts.verbose === true,
        maxEndpoints: typeof opts.maxEndpoints === "number" ? opts.maxEndpoints : undefined,
      });
    });
}

/**
 * ARV-173 (m-20): `zond probe webhooks` — offline shape-conformance for
 * webhook events captured by `docs/recipes/webhook-receiver.md`.
 *
 * Live HTTP infrastructure (tunnels, listeners) lives in the recipe,
 * not in core zond. The CLI takes a pre-captured ndjson log + the
 * API's spec and validates each event's payload against
 * `spec.webhooks.<event>.post.requestBody`. Same recipe/probe split as
 * m-18's quicktype and interactsh.
 */
function defineProbeWebhooks(parent: Command, name: string): void {
  const sub = parent
    .command(`${name} [spec]`)
    .description("Shape-conform captured webhook events (ndjson) against spec.webhooks. Recipe: docs/recipes/webhook-receiver.md")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .requiredOption("--event-log <file>", "ndjson event log captured by the recipe (one JSON event per line)")
    .option("--only <types>", "Comma-separated event types to validate (default: all declared)");
  addProbeReportOutputOptions(sub);
  sub.action(async (specPos: string | undefined, opts, cmd: Command) => {
    const apiName = resolveProbeApi(opts.api, cmd);
    const resolved = resolveSpecArg(specPos, apiName, opts.db);
    if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
    const json = globalJson(cmd);
    const rep = resolveProbeOutputFlags("probe-webhooks", opts, json);
    if (!rep) { process.exitCode = 2; return; }
    process.exitCode = await probeWebhooksCommand({
      specPath: resolved.spec,
      eventLog: opts.eventLog,
      only: opts.only,
      report: rep.report,
      output: rep.output,
      json,
    });
  });
}

export function registerProbes(program: Command): void {
  const probeCmd = program
    .command("probe")
    .description("Run a probe class — pick one of: static, mass-assignment, security, webhooks");

  defineProbeStatic(probeCmd, "static");
  defineProbeMassAssignment(probeCmd, "mass-assignment");
  defineProbeSecurity(probeCmd, "security");
  defineProbeWebhooks(probeCmd, "webhooks");
}
