import { Command, InvalidArgumentError, Option } from "commander";

import { runCommand } from "./commands/run.ts";
import { validateCommand } from "./commands/validate.ts";
import { serveCommand } from "./commands/serve.ts";
import { coverageCommand } from "./commands/coverage.ts";
import { ciInitCommand } from "./commands/ci-init.ts";
import { initCommand } from "./commands/init.ts";
import { describeCommand } from "./commands/describe.ts";
import { dbCommand } from "./commands/db.ts";
import { requestCommand } from "./commands/request.ts";
import { generateCommand } from "./commands/generate.ts";
import { probeValidationCommand } from "./commands/probe-validation.ts";
import { probeMethodsCommand } from "./commands/probe-methods.ts";
import { lintSpecCommand } from "./commands/lint-spec.ts";
import { probeMassAssignmentCommand } from "./commands/probe-mass-assignment.ts";
import { exportCommand } from "./commands/export.ts";
import { reportExportHtmlCommand, reportCaseStudyCommand } from "./commands/report.ts";
import { updateCommand } from "./commands/update.ts";
import { catalogCommand } from "./commands/catalog.ts";
import { completionsCommand, COMPLETION_SHELLS, type CompletionShell } from "./commands/completions.ts";
import { useCommand } from "./commands/use.ts";
import {
  sessionStartCommand,
  sessionEndCommand,
  sessionStatusCommand,
} from "./commands/session.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { refreshApiCommand } from "./commands/refresh-api.ts";
import { addApiCommand } from "./commands/add-api.ts";
import { resolveSessionId } from "../core/context/session.ts";
import { resolveCollectionSpec } from "../core/setup-api.ts";

import { readCurrentApi } from "../core/context/current.ts";
import { printError } from "./output.ts";
import { jsonError, printJson } from "./json-envelope.ts";
import { getRuntimeInfo } from "./runtime.ts";
import { VERSION } from "./version.ts";
import { getDb } from "../db/schema.ts";
import { findCollectionByNameOrId } from "../db/queries.ts";
import type { ReporterName } from "../core/reporter/types.ts";

// ── MSYS path preprocessing ──
//
// Git Bash on Windows converts API paths like "/users" → "C:/Program Files/Git/users".
// We reverse that for flags whose values are API paths, not filesystem paths.

const MSYS_PREFIX_RE = /^[A-Z]:[\\/](?:Program Files[\\/]Git|msys64|usr)[\\/]/i;

const API_PATH_FLAGS = new Set(["--path", "--json-path"]);

function stripMsysPath(value: string): string {
  if (!MSYS_PREFIX_RE.test(value)) return value;
  return value.replace(MSYS_PREFIX_RE, "/");
}

/**
 * Pre-process argv before commander sees it: undo Git Bash's MSYS path conversion
 * for `--path` and `--json-path` values (both `--path X` and `--path=X` forms).
 */
export function preprocessArgv(argv: string[]): string[] {
  const out = [...argv];
  for (let i = 0; i < out.length; i++) {
    const arg = out[i]!;

    // --flag=value form
    const eqIdx = arg.indexOf("=");
    if (arg.startsWith("--") && eqIdx !== -1) {
      const flag = arg.slice(0, eqIdx);
      if (API_PATH_FLAGS.has(flag)) {
        out[i] = `${flag}=${stripMsysPath(arg.slice(eqIdx + 1))}`;
      }
      continue;
    }

    // --flag value form
    if (API_PATH_FLAGS.has(arg)) {
      const next = out[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out[i + 1] = stripMsysPath(next);
      }
    }
  }
  return out;
}

// ── Argument parsers ──

function parsePositiveInt(name: string): (raw: string) => number {
  return (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) {
      throw new InvalidArgumentError(`Invalid ${name} value: ${raw}`);
    }
    return n;
  };
}

/** `--rate-limit` accepts a positive integer (req/sec cap) or the literal
 *  string `auto` (no static cap; throttle adaptively from ratelimit-* headers). */
function parseRateLimit(raw: string): number | "auto" {
  if (raw.toLowerCase() === "auto") return "auto";
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new InvalidArgumentError(`Invalid --rate-limit value: ${raw} (expected a positive integer or "auto")`);
  }
  return n;
}

function parseInteger(name: string): (raw: string) => number {
  return (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) {
      throw new InvalidArgumentError(`Invalid ${name} value: ${raw}`);
    }
    return n;
  };
}

function parsePercentage(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0 || n > 100) {
    throw new InvalidArgumentError(`Invalid --fail-on-coverage value: ${raw} (must be 0–100)`);
  }
  return n;
}

const collect = (val: string, prev: string[]): string[] => [...prev, val];

const VALID_REPORTERS = new Set<string>(["console", "json", "junit"]);

function parseReporter(raw: string): ReporterName {
  if (!VALID_REPORTERS.has(raw)) {
    throw new InvalidArgumentError(`Unknown reporter: ${raw}. Available: console, json, junit`);
  }
  return raw as ReporterName;
}

// Helper: split repeatable values like ["a,b", "c"] → ["a", "b", "c"]
function flatSplit(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const out = values.flatMap((v) => v.split(",")).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

// TASK-73: --json is a per-command option (not a top-level global) so that
// `run --json` does not collide with `run --report json`. Subcommands that
// support an envelope output add `.option("--json", ...)` themselves and we
// read it from local opts.
function globalJson(cmd: Command): boolean {
  return cmd.opts().json === true;
}

// Resolve API collection → returns { spec?, testPath? } or null when not found
function resolveApiCollection(apiName: string, dbPath: string | undefined):
  | { spec: string | null; testPath: string | null }
  | { error: string } {
  if (typeof apiName !== "string" || apiName.length === 0) {
    return { error: "Internal: --api received non-string value" };
  }
  try {
    getDb(dbPath);
    const col = findCollectionByNameOrId(apiName);
    if (!col) return { error: `API '${apiName}' not found` };
    const spec = col.openapi_spec ? resolveCollectionSpec(col.openapi_spec) : null;
    return { spec, testPath: col.test_path ?? null };
  } catch (err) {
    return { error: `Failed to resolve --api: ${(err as Error).message}` };
  }
}

/**
 * Resolve a `<spec>` argument used by spec-consuming commands —
 * catalog, sync, generate, probe-validation, probe-methods,
 * probe-mass-assignment, lint-spec, describe, guide.
 *
 * Resolution order:
 *   1. Explicit positional/flag value — used as-is (URL or filesystem path).
 *   2. --api <name> — look up the workspace-local snapshot via
 *      `resolveCollectionSpec`.
 *   3. .zond-current — same lookup using the currently-selected API.
 *
 * Returns `{ spec }` on success, `{ error }` on failure. Centralised here
 * so commands stay thin and skill/CI prompts can rely on either form.
 */
function resolveSpecArg(
  positional: string | undefined,
  apiFlag: string | undefined,
  dbPath: string | undefined,
): { spec: string } | { error: string } {
  if (typeof positional === "string" && positional.length > 0) {
    return { spec: positional };
  }
  const apiName = apiFlag ?? readCurrentApi() ?? undefined;
  if (!apiName) {
    return {
      error: "Need a spec — pass it positionally, via --api <name>, or set the current API with `zond use <name>`.",
    };
  }
  const resolved = resolveApiCollection(apiName, dbPath);
  if ("error" in resolved) return { error: resolved.error };
  if (!resolved.spec) {
    return {
      error:
        `API '${apiName}' is registered without an OpenAPI spec — this command needs one. ` +
        `Run \`zond refresh-api ${apiName} --spec <path|url>\` to attach a spec, ` +
        `or use \`zond run --api ${apiName} <test.yaml>\` for YAML-based testing.`,
    };
  }
  return { spec: resolved.spec };
}

// ── Program builder ──

export function buildProgram(): Command {
  const program = new Command("zond")
    .description("API Testing Platform")
    .version(`${VERSION} (${getRuntimeInfo()})`, "-v, --version", "Show version")
    .helpOption("-h, --help", "Show this help")
    .showHelpAfterError("(run 'zond --help' for usage)")
    .exitOverride();

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
    .option("--no-db", "Do not save results to zond.db")
    .option("--db <path>", "Path to SQLite database file (default: zond.db)")
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

  // ── validate ──
  program
    .command("validate <path>")
    .description("Validate test files without running")
    .action(async (path: string, _opts, cmd: Command) => {
      process.exitCode = await validateCommand({ path, json: globalJson(cmd) });
    });

  // ── serve ──
  program
    .command("serve")
    .description("Start web dashboard")
    .option("--port <port>", "Server port (default: 8080)", parsePositiveInt("--port"))
    .option("--host <host>", "Server host (default: 0.0.0.0)")
    .option("--db <path>", "Path to SQLite database file (default: zond.db)")
    .option("--open", "Open dashboard in browser after starting")
    .option("--watch", "Enable dev mode with hot reload (auto-refresh on file changes)")
    .option("--kill-existing", "Kill any process holding the requested port (DANGEROUS — can terminate your dev server)")
    .action(async (opts) => {
      process.exitCode = await serveCommand({
        port: opts.port,
        host: opts.host,
        dbPath: opts.db,
        watch: opts.watch === true,
        open: opts.open === true,
        killExisting: opts.killExisting === true,
      });
    });

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

  // ── use ──
  program
    .command("use [api]")
    .description("Set or show the current API for this workspace (.zond-current)")
    .option("--clear", "Remove .zond-current from the current directory")
    .action(async (api: string | undefined, opts, cmd: Command) => {
      process.exitCode = await useCommand({
        api,
        clear: opts.clear === true,
        json: globalJson(cmd),
      });
    });

  // ── refresh-api ──
  program
    .command("refresh-api <name>")
    .description("Re-snapshot the OpenAPI spec into apis/<name>/spec.json and regenerate the 3 artifacts (catalog/resources/fixtures)")
    .option("--spec <path>", "Pull fresh from this path or URL (overrides registered source)")
    .option("--insecure", "Allow self-signed TLS when --spec is an https URL")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (name: string, opts, cmd: Command) => {
      process.exitCode = await refreshApiCommand({
        api: name,
        spec: opts.spec,
        insecure: opts.insecure === true,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        json: globalJson(cmd),
      });
    });

  // ── doctor ──
  program
    .command("doctor")
    .description("Diagnose registered API: fixture gaps in .env.yaml + artifact freshness vs spec.json")
    .option("--api <name>", "API collection name (defaults to the only registered one)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await doctorCommand({
        api: opts.api,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        json: globalJson(cmd),
      });
    });

  // ── session ──
  //
  // Group multiple `zond run` calls under one session_id without juggling env
  // vars. `start` writes a UUID to .zond/current-session; subsequent `run`
  // calls auto-pick it up (priority: --session-id flag > ZOND_SESSION_ID env
  // > current-session file).
  const session = program.command("session").description("Manage run grouping (campaigns)");
  session
    .command("start")
    .description("Begin a session — group all subsequent 'zond run' calls under one session_id (.zond/current-session)")
    .option("--label <text>", "Optional human-readable label shown alongside the session in the UI")
    .option("--id <uuid>", "Reuse a specific UUID instead of generating one (useful for CI)")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await sessionStartCommand({
        label: opts.label,
        id: opts.id,
        json: globalJson(cmd),
      });
    });
  session
    .command("end")
    .description("End the current session — remove .zond/current-session")
    .action(async (_opts, cmd: Command) => {
      process.exitCode = await sessionEndCommand({ json: globalJson(cmd) });
    });
  session
    .command("status")
    .description("Show the active session (if any)")
    .action(async (_opts, cmd: Command) => {
      process.exitCode = await sessionStatusCommand({ json: globalJson(cmd) });
    });

  // ── coverage ──
  program
    .command("coverage")
    .description("Analyze API test coverage")
    .option("--api <name>", "Use API collection (auto-resolves spec and tests dir)")
    .option("--spec <path>", "Path to OpenAPI spec (required unless --api used)")
    .option("--tests <dir>", "Path to test files directory (required unless --api used)")
    .option("--fail-on-coverage <N>", "Exit 1 when coverage percentage is below N (0–100)", parsePercentage)
    .option("--run-id <number>", "Cross-reference with a test run for pass/fail/5xx breakdown", parseInteger("--run-id"))
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      let spec: string | undefined = opts.spec;
      let tests: string | undefined = opts.tests;
      const apiFlag = (opts.api as string | undefined) ?? (spec || tests ? undefined : readCurrentApi() ?? undefined);

      if (apiFlag) {
        const resolved = resolveApiCollection(apiFlag, opts.db);
        if ("error" in resolved) {
          printError(resolved.error);
          process.exitCode = resolved.error.startsWith("Failed") ? 2 : 1;
          return;
        }
        if (!spec && resolved.spec) spec = resolved.spec;
        if (!tests && resolved.testPath) tests = resolved.testPath;
      }
      if (!spec) {
        printError("Missing --spec <path>. Usage: zond coverage --spec <path> --tests <dir>");
        process.exitCode = 2;
        return;
      }
      if (!tests) {
        printError("Missing --tests <dir>. Usage: zond coverage --spec <path> --tests <dir>");
        process.exitCode = 2;
        return;
      }
      process.exitCode = await coverageCommand({
        spec,
        tests,
        failOnCoverage: opts.failOnCoverage,
        runId: opts.runId,
        json: globalJson(cmd),
      });
    });

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

  // ── describe ──
  program
    .command("describe [spec]")
    .description("Describe endpoints from OpenAPI spec")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--compact", "List all endpoints briefly")
    .option("--list-params", "List all unique parameters across all endpoints")
    .option("--method <method>", "HTTP method for single endpoint detail")
    .option("--path <path>", "Endpoint path for single endpoint detail")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await describeCommand({
        specPath: resolved.spec,
        compact: opts.compact === true,
        listParams: opts.listParams === true,
        method: opts.method,
        path: opts.path,
        json: globalJson(cmd),
      });
    });

  // ── db (nested) ──
  const db = program.command("db").description("Query the test database");

  db
    .command("collections")
    .description("List all API collections")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "collections",
        positional: [],
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("runs")
    .description("List recent test runs")
    .option("--limit <N>", "Maximum number of runs to display", parsePositiveInt("--limit"))
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "runs",
        positional: [],
        limit: opts.limit,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("run <id>")
    .description("Show run details")
    .option("--verbose", "Show all results")
    .option("--method <method>", "Filter by HTTP method")
    .option("--status <code>", "Filter by HTTP status code", parseInteger("--status"))
    .option("--db <path>", "Path to SQLite database file")
    .action(async (id: string, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "run",
        positional: [id],
        verbose: opts.verbose === true,
        method: opts.method,
        status: opts.status,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("diagnose <id>")
    .description("Diagnose run failures")
    .option("--limit <N>", "Examples per failure group", parsePositiveInt("--limit"))
    .option("--verbose", "Show all examples (not grouped)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (id: string, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "diagnose",
        positional: [id],
        limit: opts.limit,
        verbose: opts.verbose === true,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  db
    .command("compare <idA> <idB>")
    .description("Compare two runs")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (idA: string, idB: string, opts, cmd: Command) => {
      process.exitCode = await dbCommand({
        subcommand: "compare",
        positional: [idA, idB],
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  // ── request ──
  program
    .command("request <method> <url>")
    .description("Send an ad-hoc HTTP request")
    .option("--header <H>", `Request header "Name: Value" (repeatable)`, collect, [])
    .option("--body <json>", "Request body (JSON string)")
    .option("--timeout <ms>", "Request timeout", parsePositiveInt("--timeout"))
    .option("--env <name>", "Environment for variable interpolation")
    .option("--api <name>", "Collection name (loads env from its directory)")
    .option("--json-path <path>", "Extract value from response (dot notation)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (method: string, url: string, opts, cmd: Command) => {
      const headers = (opts.header as string[] | undefined)?.length ? (opts.header as string[]) : undefined;
      const api = (opts.api as string | undefined) ?? readCurrentApi() ?? undefined;
      process.exitCode = await requestCommand({
        method,
        url,
        headers,
        body: opts.body,
        timeout: opts.timeout,
        env: opts.env,
        api,
        jsonPath: opts.jsonPath,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  // ── generate ──
  program
    .command("generate [spec]")
    .description("Generate test suites from OpenAPI spec")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .requiredOption("--output <dir>", "Output directory for generated test files")
    .option("--tag <tag>", "Generate only for endpoints with this tag")
    .option("--uncovered-only", "Skip endpoints already covered by existing tests")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await generateCommand({
        specPath: resolved.spec,
        output: opts.output,
        tag: opts.tag,
        uncoveredOnly: opts.uncoveredOnly === true,
        json: globalJson(cmd),
      });
    });

  // ── probe-validation ──
  program
    .command("probe-validation [spec]")
    .description("Generate negative-input probe suites (catches 5xx-on-bad-input bugs)")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .requiredOption("--output <dir>", "Output directory for generated probe files")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--list-tags", "List available tags from spec and exit")
    .option("--max-per-endpoint <N>", "Cap probes per endpoint (default 50)", parsePositiveInt("--max-per-endpoint"))
    .option("--no-cleanup", "Skip emission of follow-up DELETE cleanup steps for mutating probes (use in namespace-isolated test envs)")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await probeValidationCommand({
        specPath: resolved.spec,
        output: opts.output,
        tag: opts.tag,
        maxPerEndpoint: opts.maxPerEndpoint,
        // Commander: --no-cleanup → opts.cleanup === false; default is true.
        noCleanup: opts.cleanup === false,
        json: globalJson(cmd),
        listTags: opts.listTags,
      });
    });

  // ── probe-mass-assignment ──
  program
    .command("probe-mass-assignment [spec]")
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
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await probeMassAssignmentCommand({
        specPath: resolved.spec,
        env: opts.env,
        output: opts.output,
        emitTests: opts.emitTests,
        tag: opts.tag,
        listTags: opts.listTags,
        // Commander: --no-cleanup → opts.cleanup === false; default is true.
        noCleanup: opts.cleanup === false,
        noDiscover: opts.discover === false,
        timeoutMs: opts.timeout,
        json: globalJson(cmd),
      });
    });

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

  // ── probe-methods ──
  program
    .command("probe-methods [spec]")
    .description("Generate negative-method probe suites (catches 5xx/2xx on undeclared HTTP methods)")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .requiredOption("--output <dir>", "Output directory for generated probe files")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      process.exitCode = await probeMethodsCommand({
        specPath: resolved.spec,
        output: opts.output,
        tag: opts.tag,
        json: globalJson(cmd),
      });
    });

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
    .action(async (runId: string, opts, cmd: Command) => {
      process.exitCode = await reportExportHtmlCommand({
        runId,
        output: opts.output,
        api: opts.api,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });

  reportCmd
    .command("case-study <failure-id>")
    .description("Generate a markdown case-study draft for a single failure (results.id) — ready to pipe into `gh issue create --body-file -`")
    .option("-o, --output <file>", "Write the draft to a file (default: print to stdout)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (failureId: string, opts, cmd: Command) => {
      process.exitCode = await reportCaseStudyCommand({
        failureId,
        output: opts.output,
        dbPath: opts.db,
        stdout: !opts.output,
        json: globalJson(cmd),
      });
    });

  // ── update / self-update ──
  program
    .command("update")
    .alias("self-update")
    .description("Check for updates and self-update the binary")
    .option("--check", "Only check for updates, do not download")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await updateCommand({
        check: opts.check === true,
        json: globalJson(cmd),
      });
    });

  // ── completions ──
  program
    .command("completions <shell>")
    .description(`Generate shell completion script (${COMPLETION_SHELLS.join(", ")})`)
    .action((shell: string) => {
      if (!(COMPLETION_SHELLS as readonly string[]).includes(shell)) {
        printError(`Unsupported shell: ${shell}. Supported: ${COMPLETION_SHELLS.join(", ")}`);
        process.exitCode = 2;
        return;
      }
      process.exitCode = completionsCommand({ shell: shell as CompletionShell, program });
    });

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
