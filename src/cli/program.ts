import { Command, Option } from "commander";

import { runCommand } from "./commands/run.ts";
import { registerValidate } from "./commands/validate.ts";
import { registerServe } from "./commands/serve.ts";
import { registerCoverage } from "./commands/coverage.ts";
import { ciInitCommand } from "./commands/ci-init.ts";
import { registerClean } from "./commands/clean.ts";
import { getSecretRegistry } from "../core/secrets/registry.ts";
import { initCommand } from "./commands/init/index.ts";
import { registerDescribe } from "./commands/describe.ts";
import { registerDb } from "./commands/db.ts";
import { registerRequest } from "./commands/request.ts";
import { generateCommand } from "./commands/generate.ts";
import { discoverCommand } from "./commands/discover.ts";
import { probeValidationCommand } from "./commands/probe-validation.ts";
import { probeMethodsCommand } from "./commands/probe-methods.ts";
import { lintSpecCommand } from "./commands/lint-spec.ts";
import { probeMassAssignmentCommand } from "./commands/probe-mass-assignment.ts";
import { probeSecurityCommand } from "./commands/probe-security.ts";
import { exportCommand } from "./commands/export.ts";
import { reportExportHtmlCommand, reportCaseStudyCommand } from "./commands/report.ts";
import { registerUpdate } from "./commands/update.ts";
import { catalogCommand } from "./commands/catalog.ts";
import { registerCompletions } from "./commands/completions.ts";
import { registerUse } from "./commands/use.ts";
import { registerSession } from "./commands/session.ts";
import { resolveSessionId } from "../core/context/session.ts";
import { registerDoctor } from "./commands/doctor.ts";
import { registerRefreshApi } from "./commands/refresh-api.ts";
import { addApiCommand } from "./commands/add-api.ts";

import { readCurrentApi } from "../core/context/current.ts";
import { printError } from "./output.ts";
import { jsonError, printJson } from "./json-envelope.ts";
import { getRuntimeInfo } from "./runtime.ts";
import { VERSION } from "./version.ts";
import { getDb } from "../db/schema.ts";
import { findCollectionByNameOrId } from "../db/queries.ts";
import type { ReporterName } from "../core/reporter/types.ts";
import {
  preprocessArgv,
  parsePositiveInt,
  parseRateLimit,
  parseInteger,
  parsePercentage,
  parseReporter,
  collect,
  flatSplit,
} from "./argv.ts";
import {
  globalJson,
  resolveApiCollection,
  resolveSpecArg,
  warnDeprecatedProbe,
} from "./resolve.ts";

export { preprocessArgv };

// ── Program builder ──

export function buildProgram(): Command {
  const program = new Command("zond")
    .description("API Testing Platform")
    .version(`${VERSION} (${getRuntimeInfo()})`, "-v, --version", "Show version")
    .helpOption("-h, --help", "Show this help")
    .showHelpAfterError("(run 'zond --help' for usage)")
    .exitOverride()
    // TASK-166 (m-10): global escape hatch for local debugging — disables
    // the secret registry's redaction pass everywhere (DB writes,
    // exporters, stdout). Default is redact-on. Hook is read from the
    // env var so it survives across nested subcommand parsers.
    .option("--no-redact", "Disable auto-redaction of registered secret values (debug only)")
    .hook("preAction", (thisCommand) => {
      const enabled = thisCommand.opts().redact !== false;
      // Mirror the flag into env so deeply-nested code that doesn't have
      // access to `cmd` (e.g. setup-api, exporters) can still consult it.
      process.env.ZOND_REDACT = enabled ? "1" : "0";
      getSecretRegistry().setEnabled(enabled);
    });

  // ── run ──
  program
    .command("run [path]")
    .description("Run API tests")
    .option("--env <name>", "Use environment file (.env.<name>.yaml)")
    .option("--api <name>", "Use API collection (resolves test path automatically)")
    .addOption(
      new Option("--report <format>", "Output format")
        .choices(["console", "json", "junit"])
        .default("console")
        .argParser(parseReporter),
    )
    .option("--timeout <ms>", "Override request timeout", parsePositiveInt("--timeout"))
    .option("--rate-limit <N|auto>", "Throttle requests to at most N per second, or `auto` to adapt from ratelimit-* response headers", parseRateLimit)
    .option("--bail", "Stop on first suite failure")
    .option("--sequential", "Run regular suites one after another instead of in parallel (opt-out of Promise.all)")
    .option("--no-db", "Do not save results to .zond/zond.db")
    .option("--db <path>", "Path to SQLite database file (default: .zond/zond.db)")
    .option("--auth-token <token>", "Auth token injected as {{auth_token}} variable")
    .option("--safe", "Run only GET tests (read-only, safe mode)")
    .option("--tag <tag>", "Filter suites by tag (repeatable, comma-separated)", collect, [])
    .option("--exclude-tag <tag>", "Exclude suites by tag (repeatable, comma-separated)", collect, [])
    .option("--method <method>", "Filter tests by HTTP method (e.g. GET, POST)")
    .option("--env-var <KEY=VALUE>", "Inject env variable (repeatable, overrides env file)", collect, [])
    .option("--strict-vars", "Hard-fail (exit 2) when a {{var}} reference has no producer (default: warn and continue)")
    .option("--dry-run", "Show requests without sending them (exit code always 0)")
    .option("--report-out <file>", "Write the report to a file via fs (bypass stdout). Useful when the bun wrapper or other shells contaminate stdout.")
    .option("--validate-schema", "Validate JSON responses against the OpenAPI schema (recommended for CRUD runs — catches contract drift like date-format and enum mismatches; requires --spec or a collection with openapi_spec set)")
    .option("--spec <path>", "Path or URL to OpenAPI spec used for --validate-schema (overrides the collection's openapi_spec)")
    .option("--session-id <id>", "Group this run under a session. Resolution order: --session-id flag > ZOND_SESSION_ID env > .zond/current-session file (set by 'zond session start')")
    .action(async (pathArg: string | undefined, opts, cmd: Command) => {
      let path = pathArg;
      const apiFlag = (opts.api as string | undefined) ?? (path ? undefined : readCurrentApi() ?? undefined);
      const dbPath = typeof opts.db === "string" ? opts.db : undefined;

      if (!path && apiFlag) {
        const resolved = resolveApiCollection(apiFlag, dbPath);
        if ("error" in resolved) {
          printError(resolved.error);
          process.exitCode = resolved.error.startsWith("Failed") ? 2 : 1;
          return;
        }
        if (!resolved.testPath) {
          printError(`API '${apiFlag}' has no test_path`);
          process.exitCode = 1;
          return;
        }
        path = resolved.testPath;
      }
      if (!path) {
        printError("No path given and .zond-current not set; run `zond use <api>` or pass path explicitly (or use --api <name>)");
        process.exitCode = 2;
        return;
      }

      const tags = flatSplit(opts.tag);
      const excludeTags = flatSplit(opts.excludeTag);
      const envVars = (opts.envVar as string[] | undefined)?.length ? (opts.envVar as string[]) : undefined;

      process.exitCode = await runCommand({
        path,
        env: opts.env,
        report: opts.report as ReporterName,
        timeout: opts.timeout,
        rateLimit: opts.rateLimit,
        bail: opts.bail === true,
        sequential: opts.sequential === true,
        // Commander's `--no-db` produces { db: false }; keep semantics: when --no-db given → noDb=true
        noDb: opts.db === false,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        authToken: opts.authToken,
        safe: opts.safe === true,
        tag: tags,
        excludeTag: excludeTags,
        method: opts.method,
        envVars,
        strictVars: opts.strictVars === true,
        dryRun: opts.dryRun === true,
        reportOut: typeof opts.reportOut === "string" ? opts.reportOut : undefined,
        validateSchema: opts.validateSchema === true,
        specPath: typeof opts.spec === "string" ? opts.spec : undefined,
        sessionId: resolveSessionId({
          flag: typeof opts.sessionId === "string" ? opts.sessionId : null,
          env: process.env.ZOND_SESSION_ID ?? null,
        }) ?? undefined,
        json: false,
      });
    });

  registerValidate(program);

  registerServe(program);

  // ── ci ──
  const ci = program.command("ci").description("CI/CD scaffolding");
  ci
    .command("init")
    .description("Generate CI/CD workflow (GitHub Actions, GitLab CI)")
    .option("--github", "Generate GitHub Actions workflow")
    .option("--gitlab", "Generate GitLab CI config")
    .option("--dir <path>", "Project root directory (default: current directory)")
    .option("--force", "Overwrite existing CI config")
    .action(async (opts, cmd: Command) => {
      let platform: "github" | "gitlab" | undefined;
      if (opts.github === true) platform = "github";
      else if (opts.gitlab === true) platform = "gitlab";
      process.exitCode = await ciInitCommand({
        platform,
        force: opts.force === true,
        dir: opts.dir,
        json: globalJson(cmd),
      });
    });

  registerUse(program);
  registerRefreshApi(program);
  registerDoctor(program);

  registerSession(program);
  registerCoverage(program);

  // ── init ──
  program
    .command("init [spec]")
    .description("Bootstrap a workspace, or register an API when --spec is given")
    .option("--name <name>", "API name (auto-detected from spec title if omitted)")
    .option("--spec <path>", "Path to OpenAPI spec file (registers a single API)")
    .option("--base-url <url>", "Override base URL")
    .option("--dir <path>", "Target directory")
    .option("--force", "Overwrite existing API collection")
    .option("--insecure", "Skip TLS verification when fetching the spec")
    .option("--db <path>", "Path to SQLite database file")
    .option("--workspace", "Bootstrap a zond workspace (zond.config.yml, apis/, AGENTS.md)")
    .option("--with-spec <path>", "Bootstrap workspace AND register first API from spec")
    .option("--no-agents-md", "Skip writing AGENTS.md when bootstrapping")
    .option("--no-skills", "Skip writing Claude Code skills under .claude/skills/")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const spec = opts.spec ?? specPos;
      const json = globalJson(cmd);
      // Deprecation: registering an API via `init` is now `zond add api <name>
      // --spec X`. Keep init working for one or two releases; just warn so
      // skill code and scripts migrate.
      if ((spec || opts.withSpec) && !json) {
        process.stderr.write(
          `Warning: 'zond init --spec' / '--with-spec' is deprecated. Use \`zond add api <name> --spec <path>\` (run \`zond init\` separately to bootstrap the workspace).\n`,
        );
      }
      process.exitCode = await initCommand({
        name: opts.name,
        spec,
        baseUrl: opts.baseUrl,
        dir: opts.dir,
        force: opts.force === true,
        insecure: opts.insecure === true,
        dbPath: opts.db,
        workspace: opts.workspace === true,
        withSpec: opts.withSpec,
        noAgents: opts.agentsMd === false,
        noSkills: opts.skills === false,
        json,
      });
    });

  // ── add api ──
  const add = program.command("add").description("Register objects in the workspace");
  add
    .command("api <name>")
    .description("Register an API: from an OpenAPI spec (full toolkit) or just --base-url (run-only mode)")
    .option("--spec <path>", "Path or URL to OpenAPI spec — enables generate/probe/validate-schema")
    .option("--base-url <url>", "Base URL recorded in .env.yaml (required if --spec is omitted)")
    .option("--dir <path>", "Target directory (defaults to apis/<name>/)")
    .option("--force", "Overwrite an existing API with the same name")
    .option("--insecure", "Skip TLS verification when fetching the spec from https")
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
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        json,
      });
    });

  registerDescribe(program);
  registerDb(program);
  registerRequest(program);

  registerClean(program);

  // ── generate ──
  program
    .command("generate [spec]")
    .description("Generate test suites from OpenAPI spec")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--output <dir>", "Output directory for generated test files (required unless --explain)")
    .option("--tag <tag>", "Generate only for endpoints with this tag")
    .option("--uncovered-only", "Skip endpoints already covered by existing tests")
    .option("--explain", "Print the CRUD detection table (which resources became chain candidates and why) without writing files (TASK-139)")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      if (!opts.explain && !opts.output) {
        printError("--output <dir> is required (omit only when running with --explain).");
        process.exitCode = 2;
        return;
      }
      process.exitCode = await generateCommand({
        specPath: resolved.spec,
        output: opts.output ?? "",
        tag: opts.tag,
        uncoveredOnly: opts.uncoveredOnly === true,
        explain: opts.explain === true,
        json: globalJson(cmd),
      });
    });

  // ── discover ──
  program
    .command("discover")
    .description("Auto-fill .env.yaml FK ids by hitting list-endpoints (Phase 2.5 fixture pack — TASK-136)")
    .requiredOption("--api <name>", "Registered API to discover against (apis/<name>/.env.yaml)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--api-dir <path>", "Override apis/<name>/ root (defaults to the collection's base_dir)")
    .option("--env <path>", "Override .env.yaml path (defaults to <api-dir>/.env.yaml)")
    .option("--apply", "Write discovered values to .env.yaml (with .env.yaml.bak backup). Default: dry-run.")
    .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
    .action(async (opts, cmd: Command) => {
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
      process.exitCode = await discoverCommand({
        specPath: resolved.spec,
        apiDir,
        envPath: opts.env,
        apply: opts.apply === true,
        timeoutMs: opts.timeout,
        json: globalJson(cmd),
      });
    });

  // ── probe (umbrella) + back-compat aliases ──
  // TASK-182 (m-11): four standalone probe-* commands collapsed under a
  // single `zond probe <class>` umbrella to keep the top-level help quiet.
  // Old names (`probe-validation`, `probe-methods`, `probe-mass-assignment`,
  // `probe-security`) are kept as aliases for one release and emit a
  // deprecation warning to stderr.
  function defineProbeValidation(parent: Command, name: string, deprecated: boolean): void {
    parent
      .command(`${name} [spec]`)
      .description("Generate negative-input probe suites (catches 5xx-on-bad-input bugs)")
      .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
      .option("--db <path>", "Path to SQLite database file")
      .requiredOption("--output <dir>", "Output directory for generated probe files")
      .option("--tag <tag>", "Probe only endpoints with this tag")
      .option("--list-tags", "List available tags from spec and exit")
      .option("--max-per-endpoint <N>", "Cap probes per endpoint (default 50)", parsePositiveInt("--max-per-endpoint"))
      .option("--no-cleanup", "Skip emission of follow-up DELETE cleanup steps for mutating probes (use in namespace-isolated test envs)")
      .option("--no-real-parents", "Bake synthetic-by-type values into all path params (legacy). By default, non-attacked path params are emitted as {{name}} and resolved from .env.yaml at run time — needed to reach the leaf validator on nested paths (TASK-135).")
      .action(async (specPos: string | undefined, opts, cmd: Command) => {
        if (deprecated) warnDeprecatedProbe("probe-validation", "validation");
        const resolved = resolveSpecArg(specPos, opts.api, opts.db);
        if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
        process.exitCode = await probeValidationCommand({
          specPath: resolved.spec,
          output: opts.output,
          tag: opts.tag,
          maxPerEndpoint: opts.maxPerEndpoint,
          noCleanup: opts.cleanup === false,
          useRealParents: opts.realParents !== false,
          json: globalJson(cmd),
          listTags: opts.listTags,
        });
      });
  }

  function defineProbeMassAssignment(parent: Command, name: string, deprecated: boolean): void {
    parent
      .command(`${name} [spec]`)
      .description(
        "Live probe for mass-assignment / privilege-escalation: classifies POST/PATCH/PUT against suspected extra fields (is_admin, role, account_id, owner_id, user_id, verified, is_system) as rejected (4xx) | accepted-and-applied (HIGH) | accepted-and-ignored (LOW) via follow-up GET",
      )
      .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
      .option("--db <path>", "Path to SQLite database file")
      .requiredOption("--env <file>", "Env YAML with base_url + auth_token (live calls require this)")
      .option("--output <file>", "Write markdown digest to file (default: stdout)")
      .option("--emit-tests <dir>", "Also emit YAML regression suites locking in safe behaviour for CI")
      .option("--tag <tag>", "Probe only endpoints with this tag")
      .option("--list-tags", "List available tags from spec and exit")
      .option("--no-cleanup", "Skip follow-up DELETE for resources accidentally created by 2xx probes")
      .option("--no-discover", "Disable auto-discovery of path-param fixtures via GET-on-list (TASK-92)")
      .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
      .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
      .action(async (specPos: string | undefined, opts, cmd: Command) => {
        if (deprecated) warnDeprecatedProbe("probe-mass-assignment", "mass-assignment");
        const resolved = resolveSpecArg(specPos, opts.api, opts.db);
        if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
        process.exitCode = await probeMassAssignmentCommand({
          specPath: resolved.spec,
          env: opts.env,
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

  function defineProbeSecurity(parent: Command, name: string, deprecated: boolean): void {
    parent
      .command(`${name} <classes> [spec]`)
      .description(
        "Live security probes (TASK-138): SSRF / CRLF / open-redirect. Detects vulnerable fields by name+format, sends a baseline-OK then per-field payloads, classifies HIGH (5xx or echo) / LOW (2xx no echo) / OK (4xx). <classes> is a comma-separated subset of: ssrf, crlf, open-redirect.",
      )
      .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
      .option("--db <path>", "Path to SQLite database file")
      .option("--env <file>", "Env YAML with base_url + auth_token (live calls require this; --dry-run can run without)")
      .option("--output <file>", "Write markdown digest to file (default: stdout)")
      .option("--emit-tests <dir>", "Also emit YAML regression suites locking in safe behaviour for CI")
      .option("--tag <tag>", "Probe only endpoints with this tag")
      .option("--list-tags", "List available tags from spec and exit")
      .option("--no-cleanup", "Skip follow-up DELETE on resources created by baseline / 2xx attacks")
      .option("--dry-run", "Print which endpoints/fields would be attacked without sending requests")
      .option("--timeout <ms>", "Per-request timeout in ms (default 30000)", parsePositiveInt("--timeout"))
      .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
      .action(async (classes: string, specPos: string | undefined, opts, cmd: Command) => {
        if (deprecated) warnDeprecatedProbe("probe-security", "security");
        const resolved = resolveSpecArg(specPos, opts.api, opts.db);
        if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
        process.exitCode = await probeSecurityCommand({
          specPath: resolved.spec,
          classes,
          env: opts.env,
          output: opts.output,
          emitTests: opts.emitTests,
          tag: opts.tag,
          listTags: opts.listTags,
          noCleanup: opts.cleanup === false,
          dryRun: opts.dryRun === true,
          timeoutMs: opts.timeout,
          overwrite: opts.overwrite === true,
          json: globalJson(cmd),
        });
      });
  }

  function defineProbeMethods(parent: Command, name: string, deprecated: boolean): void {
    parent
      .command(`${name} [spec]`)
      .description("Generate negative-method probe suites (catches 5xx/2xx on undeclared HTTP methods)")
      .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
      .option("--db <path>", "Path to SQLite database file")
      .requiredOption("--output <dir>", "Output directory for generated probe files")
      .option("--tag <tag>", "Probe only endpoints with this tag")
      .action(async (specPos: string | undefined, opts, cmd: Command) => {
        if (deprecated) warnDeprecatedProbe("probe-methods", "methods");
        const resolved = resolveSpecArg(specPos, opts.api, opts.db);
        if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
        process.exitCode = await probeMethodsCommand({
          specPath: resolved.spec,
          output: opts.output,
          tag: opts.tag,
          json: globalJson(cmd),
        });
      });
  }

  const probeCmd = program
    .command("probe")
    .description("Run a probe class — pick one of: validation, methods, mass-assignment, security");
  defineProbeValidation(probeCmd, "validation", false);
  defineProbeMethods(probeCmd, "methods", false);
  defineProbeMassAssignment(probeCmd, "mass-assignment", false);
  defineProbeSecurity(probeCmd, "security", false);

  defineProbeValidation(program, "probe-validation", true);
  defineProbeMassAssignment(program, "probe-mass-assignment", true);
  defineProbeSecurity(program, "probe-security", true);

  // ── lint-spec ──
  program
    .command("lint-spec [spec]")
    .description("Static-analyse an OpenAPI spec for internal-consistency and strictness gaps (catches bugs before any HTTP)")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--strict", "Exit non-zero even on LOW-severity issues")
    .option("--ndjson", "Stream issues as one JSON per line (NDJSON), instead of the wrapped envelope")
    .option("--rule <list>", "Comma-separated rule overrides: R1, !R2, R3=high|medium|low")
    .option("--config <path>", "Path to .zond-lint.json")
    .option("--include-path <glob...>", "Only lint endpoints whose path matches glob (repeatable)")
    .option("--max-issues <N>", "Stop after N issues", parsePositiveInt("--max-issues"))
    .option("--no-db", "Don't write to lint_runs SQLite history")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      // lint-spec already supports --no-db; if user passes a non-default
      // --db <path>, commander will surface it as opts.db === string.
      const dbPath = typeof opts.db === "string" ? opts.db : undefined;
      const resolved = resolveSpecArg(specPos, opts.api, dbPath);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await lintSpecCommand({
        specPath: resolved.spec,
        json: globalJson(cmd),
        ndjson: opts.ndjson === true,
        strict: opts.strict === true,
        rule: opts.rule,
        config: opts.config,
        includePath: opts.includePath,
        maxIssues: opts.maxIssues,
        // Commander: --no-db → opts.db === false
        noDb: opts.db === false,
      });
    });

  // ── probe-methods (deprecated alias) ──
  defineProbeMethods(program, "probe-methods", true);

  // ── catalog ──
  program
    .command("catalog [spec]")
    .description("Generate API catalog (compact endpoint reference). For registered APIs prefer --api <name>; the artifact is also available at apis/<name>/.api-catalog.yaml.")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--output <dir>", "Output directory (default: current directory)")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await catalogCommand({
        specPath: resolved.spec,
        output: opts.output,
        json: globalJson(cmd),
      });
    });


  // ── export (with subcommand: postman) ──
  const exportCmd = program.command("export").description("Export tests to other formats");
  exportCmd
    .command("postman <path>")
    .description("Export YAML tests as Postman Collection v2.1")
    .option("--output <file>", "Output file path", "collection.postman.json")
    .option("--env <file>", "Also export .env.yaml as Postman environment")
    .option("--collection-name <name>", "Collection name (default: derived from path)")
    .action(async (testsPath: string, opts, cmd: Command) => {
      process.exitCode = await exportCommand({
        testsPath,
        output: opts.output,
        env: opts.env,
        collectionName: opts.collectionName,
        json: globalJson(cmd),
      });
    });

  // ── report (with subcommand: export) ──
  const reportCmd = program.command("report").description("Export run reports for sharing");
  reportCmd
    .command("export <run-id>")
    .description("Export a stored run as a single-file HTML report (shareable, openable in any browser)")
    .option("--html", "Render as HTML (default and currently the only supported format)")
    .option("-o, --output <file>", "Output file path (default: zond-run-<id>.html)")
    .option("--api <name>", "Embed coverage map for this registered API (auto-detected from run.collection_id)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .option("--body-cap <n>", "Truncate request/response bodies to N bytes (default 8192). Set 0 / use --no-body-cap to disable.", parsePositiveInt("--body-cap"))
    .option("--no-body-cap", "Keep full request/response bodies (overrides --body-cap)")
    .option("--redact-identity", "Replace values from .identity.yaml with <identity:<key>> placeholders (for outbound sharing)")
    .action(async (runId: string, opts, cmd: Command) => {
      // Commander: --no-body-cap → opts.bodyCap === false, --body-cap N → opts.bodyCap === N.
      const bodyCapBytes = opts.bodyCap === false ? 0 : (typeof opts.bodyCap === "number" ? opts.bodyCap : undefined);
      process.exitCode = await reportExportHtmlCommand({
        runId,
        output: opts.output,
        api: opts.api,
        dbPath: opts.db,
        overwrite: opts.overwrite === true,
        bodyCapBytes,
        redactIdentity: opts.redactIdentity === true,
        json: globalJson(cmd),
      });
    });

  reportCmd
    .command("case-study <failure-id>")
    .description("Generate a markdown case-study draft for a single failure (results.id) — ready to pipe into `gh issue create --body-file -`")
    .option("-o, --output <file>", "Write the draft to a file (default: triage/<api>/<run>/case-study-<ts>.md)")
    .option("--stdout", "Also print the draft to stdout (so it can be piped into pbcopy / gh issue create --body-file -)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .option("--body-cap <n>", "Truncate response body to N bytes (default 8192). Set 0 / use --no-body-cap to disable.", parsePositiveInt("--body-cap"))
    .option("--no-body-cap", "Keep full response body (overrides --body-cap)")
    .option("--redact-identity", "Replace values from .identity.yaml with <identity:<key>> placeholders (for outbound sharing)")
    .action(async (failureId: string, opts, cmd: Command) => {
      const bodyCapBytes = opts.bodyCap === false ? 0 : (typeof opts.bodyCap === "number" ? opts.bodyCap : undefined);
      process.exitCode = await reportCaseStudyCommand({
        failureId,
        output: opts.output,
        dbPath: opts.db,
        stdout: opts.stdout === true,
        overwrite: opts.overwrite === true,
        bodyCapBytes,
        redactIdentity: opts.redactIdentity === true,
        json: globalJson(cmd),
      });
    });

  registerUpdate(program);
  registerCompletions(program);

  // TASK-73: previously `--json` was a top-level/global option that propagated
  // to every subcommand, which collided with `run --report json` (and broke
  // `run --json` outright). Now it is per-command. Attach `--json` to every
  // subcommand that previously read it via globalJson(), EXCEPT `run` —
  // run's only JSON output path is `--report json`.
  // Skip by fully-qualified path so `db run` (inner) keeps --json while
  // top-level `run` does not.
  const skipJson = new Set(["run", "completions", "serve"]);
  const attachJson = (cmd: Command, parentPath: string): void => {
    const path = parentPath ? `${parentPath} ${cmd.name()}` : cmd.name();
    // Only leaf commands (those with action handlers) get --json — parent
    // namespace commands like `db` and `ci` would otherwise shadow the option
    // on their children and `cmd.opts()` on the leaf would not see --json.
    const hasAction = (cmd as unknown as { _actionHandler?: unknown })._actionHandler != null;
    if (hasAction && !skipJson.has(path)) {
      cmd.option("--json", "Output in JSON envelope format");
    }
    for (const sub of cmd.commands) attachJson(sub, path);
  };
  for (const sub of program.commands) attachJson(sub, "");

  return program;
}
