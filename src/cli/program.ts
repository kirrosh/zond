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
import { guideCommand } from "./commands/guide.ts";
import { generateCommand } from "./commands/generate.ts";
import { probeValidationCommand } from "./commands/probe-validation.ts";
import { probeMethodsCommand } from "./commands/probe-methods.ts";
import { exportCommand } from "./commands/export.ts";
import { syncCommand } from "./commands/sync.ts";
import { updateCommand } from "./commands/update.ts";
import { catalogCommand } from "./commands/catalog.ts";
import { completionsCommand, COMPLETION_SHELLS, type CompletionShell } from "./commands/completions.ts";
import { mcpStartCommand } from "./commands/mcp.ts";
import { installCommand } from "./commands/install.ts";
import { useCommand } from "./commands/use.ts";

import { readCurrentApi } from "../core/context/current.ts";
import { printError } from "./output.ts";
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

// Helper: read a global option from any command in the tree
function globalJson(cmd: Command): boolean {
  return cmd.optsWithGlobals().json === true;
}

// Resolve API collection → returns { spec?, testPath? } or null when not found
function resolveApiCollection(apiName: string, dbPath: string | undefined):
  | { spec: string | null; testPath: string | null }
  | { error: string } {
  try {
    getDb(dbPath);
    const col = findCollectionByNameOrId(apiName);
    if (!col) return { error: `API '${apiName}' not found` };
    return { spec: col.openapi_spec ?? null, testPath: col.test_path ?? null };
  } catch (err) {
    return { error: `Failed to resolve --api: ${(err as Error).message}` };
  }
}

// ── Program builder ──

export function buildProgram(): Command {
  const program = new Command("zond")
    .description("API Testing Platform")
    .version(`${VERSION} (${getRuntimeInfo()})`, "-v, --version", "Show version")
    .helpOption("-h, --help", "Show this help")
    .option("--json", "Output in JSON envelope format")
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
    .option("--rate-limit <N>", "Throttle requests to at most N per second (set 1 below the real API cap to avoid boundary 429s)", parsePositiveInt("--rate-limit"))
    .option("--bail", "Stop on first suite failure")
    .option("--no-db", "Do not save results to zond.db")
    .option("--db <path>", "Path to SQLite database file (default: zond.db)")
    .option("--auth-token <token>", "Auth token injected as {{auth_token}} variable")
    .option("--safe", "Run only GET tests (read-only, safe mode)")
    .option("--tag <tag>", "Filter suites by tag (repeatable, comma-separated)", collect, [])
    .option("--exclude-tag <tag>", "Exclude suites by tag (repeatable, comma-separated)", collect, [])
    .option("--method <method>", "Filter tests by HTTP method (e.g. GET, POST)")
    .option("--env-var <KEY=VALUE>", "Inject env variable (repeatable, overrides env file)", collect, [])
    .option("--dry-run", "Show requests without sending them (exit code always 0)")
    .action(async (pathArg: string | undefined, opts, cmd: Command) => {
      let path = pathArg;
      const apiFlag = (opts.api as string | undefined) ?? (path ? undefined : readCurrentApi() ?? undefined);
      const dbPath = opts.db as string | undefined;

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
        printError("Missing path argument. Usage: zond run <path> or zond run --api <name> (or set with `zond use`)");
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
        // Commander's `--no-db` produces { db: false }; keep semantics: when --no-db given → noDb=true
        noDb: opts.db === false,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        authToken: opts.authToken,
        safe: opts.safe === true,
        tag: tags,
        excludeTag: excludeTags,
        method: opts.method,
        envVars,
        dryRun: opts.dryRun === true,
        json: globalJson(cmd),
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

  // ── mcp ──
  const mcp = program.command("mcp").description("Model Context Protocol server");
  mcp
    .command("start")
    .description("Start MCP server over stdio for AI agents (Claude, Cursor, etc.)")
    .option("--db <path>", "Path to SQLite database file (default: zond.db)")
    .action(async (opts) => {
      process.exitCode = await mcpStartCommand({ dbPath: opts.db });
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

  // ── install ──
  program
    .command("install")
    .description("Configure zond MCP server for AI clients (Claude Code, Cursor)")
    .option("--claude", "Configure ~/.claude/mcp.json")
    .option("--cursor", "Configure ~/.cursor/mcp.json")
    .option("--all", "Configure all supported clients")
    .option("--dry-run", "Show what would be written without modifying any files")
    .option("--no-sanity", "Skip the in-process tools/list smoke check")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await installCommand({
        claude: opts.claude,
        cursor: opts.cursor,
        all: opts.all,
        dryRun: opts.dryRun,
        sanity: opts.sanity,
        json: globalJson(cmd),
      });
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
    .addOption(
      new Option("--integration <mode>", "AI agent integration when bootstrapping")
        .choices(["mcp", "cli", "skip"])
        .default("mcp"),
    )
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      process.exitCode = await initCommand({
        name: opts.name,
        spec: opts.spec ?? specPos,
        baseUrl: opts.baseUrl,
        dir: opts.dir,
        force: opts.force === true,
        insecure: opts.insecure === true,
        dbPath: opts.db,
        workspace: opts.workspace === true,
        withSpec: opts.withSpec,
        integration: opts.integration as "mcp" | "cli" | "skip" | undefined,
        json: globalJson(cmd),
      });
    });

  // ── describe ──
  program
    .command("describe <spec>")
    .description("Describe endpoints from OpenAPI spec")
    .option("--compact", "List all endpoints briefly")
    .option("--list-params", "List all unique parameters across all endpoints")
    .option("--method <method>", "HTTP method for single endpoint detail")
    .option("--path <path>", "Endpoint path for single endpoint detail")
    .action(async (specPath: string, opts, cmd: Command) => {
      process.exitCode = await describeCommand({
        specPath,
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
    .command("generate <spec>")
    .description("Generate test suites from OpenAPI spec")
    .requiredOption("--output <dir>", "Output directory for generated test files")
    .option("--tag <tag>", "Generate only for endpoints with this tag")
    .option("--uncovered-only", "Skip endpoints already covered by existing tests")
    .action(async (specPath: string, opts, cmd: Command) => {
      process.exitCode = await generateCommand({
        specPath,
        output: opts.output,
        tag: opts.tag,
        uncoveredOnly: opts.uncoveredOnly === true,
        json: globalJson(cmd),
      });
    });

  // ── probe-validation ──
  program
    .command("probe-validation <spec>")
    .description("Generate negative-input probe suites (catches 5xx-on-bad-input bugs)")
    .requiredOption("--output <dir>", "Output directory for generated probe files")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .option("--max-per-endpoint <N>", "Cap probes per endpoint (default 50)", parsePositiveInt("--max-per-endpoint"))
    .action(async (specPath: string, opts, cmd: Command) => {
      process.exitCode = await probeValidationCommand({
        specPath,
        output: opts.output,
        tag: opts.tag,
        maxPerEndpoint: opts.maxPerEndpoint,
        json: globalJson(cmd),
      });
    });

  // ── probe-methods ──
  program
    .command("probe-methods <spec>")
    .description("Generate negative-method probe suites (catches 5xx/2xx on undeclared HTTP methods)")
    .requiredOption("--output <dir>", "Output directory for generated probe files")
    .option("--tag <tag>", "Probe only endpoints with this tag")
    .action(async (specPath: string, opts, cmd: Command) => {
      process.exitCode = await probeMethodsCommand({
        specPath,
        output: opts.output,
        tag: opts.tag,
        json: globalJson(cmd),
      });
    });

  // ── catalog ──
  program
    .command("catalog <spec>")
    .description("Generate API catalog (compact endpoint reference)")
    .option("--output <dir>", "Output directory (default: current directory)")
    .action(async (specPath: string, opts, cmd: Command) => {
      process.exitCode = await catalogCommand({
        specPath,
        output: opts.output,
        json: globalJson(cmd),
      });
    });

  // ── guide ──
  program
    .command("guide <spec>")
    .description("Generate test generation guide from OpenAPI spec")
    .option("--tests-dir <dir>", "Filter to uncovered endpoints only")
    .option("--tag <tag>", "Generate only for endpoints with this tag")
    .action(async (specPath: string, opts, cmd: Command) => {
      process.exitCode = await guideCommand({
        specPath,
        testsDir: opts.testsDir,
        tag: opts.tag,
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

  // ── sync ──
  program
    .command("sync <spec>")
    .description("Detect new/removed endpoints and generate tests for new ones")
    .requiredOption("--tests <dir>", "Path to test files directory")
    .option("--dry-run", "Show what would be generated without writing files")
    .option("--tag <tag>", "Limit sync to endpoints with this tag")
    .action(async (specPath: string, opts, cmd: Command) => {
      process.exitCode = await syncCommand({
        specPath,
        testsDir: opts.tests,
        dryRun: opts.dryRun === true,
        tag: opts.tag,
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

  return program;
}
