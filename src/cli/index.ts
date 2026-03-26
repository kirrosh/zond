#!/usr/bin/env bun

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
import { printError } from "./output.ts";
import { getRuntimeInfo } from "./runtime.ts";
import { getDb } from "../db/schema.ts";
import { findCollectionByNameOrId } from "../db/queries.ts";
import type { ReporterName } from "../core/reporter/types.ts";

import { version as pkgVersion } from "../../package.json";
export const VERSION = pkgVersion;

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Strip MSYS/Git Bash automatic path conversion.
 * Git Bash on Windows converts "/foo" → "C:/Program Files/Git/foo".
 * Detect and reverse this for flags that expect API paths (e.g. --path /users).
 */
const MSYS_PREFIX_RE = /^[A-Z]:[\\/](?:Program Files[\\/]Git|msys64|usr)[\\/]/i;

function stripMsysPath(value: string): string {
  if (!MSYS_PREFIX_RE.test(value)) return value;
  // Extract the original path: "C:/Program Files/Git/products" → "/products"
  const stripped = value.replace(MSYS_PREFIX_RE, "/");
  return stripped;
}

/** Flags whose values are API paths, not filesystem paths — subject to MSYS fix */
const API_PATH_FLAGS = new Set(["path", "json-path"]);

export function parseArgs(argv: string[]): ParsedArgs {
  // argv: [bunPath, scriptPath, ...userArgs]
  const args = argv.slice(2);
  let command: string | undefined;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        // --flag=value
        const key = arg.slice(2, eqIndex);
        let val = arg.slice(eqIndex + 1);
        if (API_PATH_FLAGS.has(key)) val = stripMsysPath(val);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = API_PATH_FLAGS.has(key) ? stripMsysPath(next) : next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Short flag: -h, -v
      flags[arg.slice(1)] = true;
    } else if (command === undefined) {
      command = arg;
    } else {
      positional.push(arg);
    }

    i++;
  }

  return { command, positional, flags };
}

function printUsage(): void {
  console.log(`zond - API Testing Platform

Usage:
  zond run <path>       Run API tests
  zond validate <path>  Validate test files without running
  zond coverage         Analyze API test coverage
  zond init             Register a new API for testing
  zond describe <spec>  Describe endpoints from OpenAPI spec
  zond db <subcommand>  Query the test database
  zond request <method> <url>  Send an ad-hoc HTTP request
  zond generate <spec>  Generate test suites from OpenAPI spec
  zond guide <spec>     Generate test generation guide from OpenAPI spec
  zond serve            Start web dashboard
  zond ui               Alias for 'serve --open' (start dashboard & open browser)
  zond ci init          Generate CI/CD workflow (GitHub Actions, GitLab CI)

Options for 'run':
  --dry-run            Show requests without sending them (exit code always 0)
  --env-var KEY=VALUE  Inject env variable (repeatable, overrides env file)
  --api <name>         Use API collection (resolves test path automatically)
  --env <name>         Use environment file (.env.<name>.yaml)
  --report <format>    Output format: console, json, junit (default: console)
  --timeout <ms>       Override request timeout
  --bail               Stop on first suite failure
  --no-db              Do not save results to zond.db
  --db <path>          Path to SQLite database file (default: zond.db)
  --auth-token <token> Auth token injected as {{auth_token}} variable
  --safe               Run only GET tests (read-only, safe mode)
  --tag <tag>          Filter suites by tag (repeatable, comma-separated, OR logic)

Options for 'init':
  --name <name>        API name (auto-detected from spec title if omitted)
  --spec <path>        Path to OpenAPI spec file
  --base-url <url>     Override base URL
  --force              Overwrite existing API collection

Options for 'describe':
  --compact            List all endpoints briefly
  --method <method>    HTTP method for single endpoint detail
  --path <path>        Endpoint path for single endpoint detail

Options for 'db':
  zond db collections           List all API collections
  zond db runs [--limit N]      List recent test runs
  zond db run <id> [--verbose]  Show run details
  zond db diagnose <id>         Diagnose run failures
  zond db compare <idA> <idB>   Compare two runs

Options for 'request':
  --header <H>         Request header "Name: Value" (repeatable)
  --body <json>        Request body (JSON string)
  --env <name>         Environment for variable interpolation
  --api <name>         Collection name (loads env from its directory)
  --json-path <path>   Extract value from response (dot notation)

Options for 'generate':
  --output <dir>       Output directory for generated test files (required)
  --tag <tag>          Generate only for endpoints with this tag
  --uncovered-only     Skip endpoints already covered by existing tests

Options for 'guide':
  --tests-dir <dir>    Filter to uncovered endpoints only
  --tag <tag>          Generate only for endpoints with this tag

Options for 'coverage':
  --api <name>         Use API collection (auto-resolves spec and tests dir)
  --spec <path>        Path to OpenAPI spec (required unless --api used)
  --tests <dir>        Path to test files directory (required unless --api used)
  --fail-on-coverage N Exit 1 when coverage percentage is below N (0–100)
  --run-id <number>    Cross-reference with a test run for pass/fail/5xx breakdown

Options for 'serve' / 'ui':
  --port <port>        Server port (default: 8080)
  --host <host>        Server host (default: 0.0.0.0)
  --db <path>          Path to SQLite database file (default: zond.db)
  --open               Open dashboard in browser after starting
  --watch              Enable dev mode with hot reload (auto-refresh browser on file changes)

Options for 'ci init':
  --github             Generate GitHub Actions workflow
  --gitlab             Generate GitLab CI config
  --dir <path>         Project root directory (default: current directory)
  --force              Overwrite existing CI config

General:
  --json               Output in JSON envelope format (available for all commands)
  --help, -h           Show this help
  --version, -v        Show version`);
}

const VALID_REPORTERS = new Set<string>(["console", "json", "junit"]);

async function main(): Promise<number> {
  const { command, positional, flags } = parseArgs(process.argv);
  const jsonFlag = flags["json"] === true;

  // Help
  if (command === "help" || command === "--help" || flags["help"] === true || flags["h"] === true) {
    printUsage();
    return 0;
  }

  // Version
  if (command === "--version" || flags["version"] === true || flags["v"] === true) {
    console.log(`zond ${VERSION} (${getRuntimeInfo()})`);
    return 0;
  }

  if (!command) {
    printUsage();
    return 0;
  }

  switch (command) {
    case "run": {
      let path = positional[0];
      const apiFlag = typeof flags["api"] === "string" ? flags["api"] : undefined;
      if (!path && apiFlag) {
        try {
          getDb(typeof flags["db"] === "string" ? flags["db"] : undefined);
          const col = findCollectionByNameOrId(apiFlag);
          if (!col) { printError(`API '${apiFlag}' not found`); return 1; }
          path = col.test_path;
        } catch (err) {
          printError(`Failed to resolve --api: ${(err as Error).message}`);
          return 2;
        }
      }
      if (!path) {
        printError("Missing path argument. Usage: zond run <path> or zond run --api <name>");
        return 2;
      }

      const report = (flags["report"] as string) ?? "console";
      if (!VALID_REPORTERS.has(report)) {
        printError(`Unknown reporter: ${report}. Available: console, json, junit`);
        return 2;
      }

      const timeoutRaw = flags["timeout"];
      let timeout: number | undefined;
      if (typeof timeoutRaw === "string") {
        timeout = parseInt(timeoutRaw, 10);
        if (isNaN(timeout) || timeout <= 0) {
          printError(`Invalid timeout value: ${timeoutRaw}`);
          return 2;
        }
      }

      // Collect all --tag and --env-var flags (parseArgs only stores last one, so re-parse)
      const tagValues: string[] = [];
      const envVarValues: string[] = [];
      const rawRunArgs = process.argv.slice(2);
      for (let i = 0; i < rawRunArgs.length; i++) {
        const arg = rawRunArgs[i]!;
        if (arg === "--tag" && rawRunArgs[i + 1]) {
          tagValues.push(rawRunArgs[i + 1]!);
          i++;
        } else if (arg.startsWith("--tag=")) {
          tagValues.push(arg.slice("--tag=".length));
        } else if (arg === "--env-var" && rawRunArgs[i + 1]) {
          envVarValues.push(rawRunArgs[i + 1]!);
          i++;
        } else if (arg.startsWith("--env-var=")) {
          envVarValues.push(arg.slice("--env-var=".length));
        }
      }
      // Support comma-separated: --tag smoke,crud → ["smoke", "crud"]
      const tags = tagValues.flatMap(v => v.split(",")).filter(Boolean);

      return runCommand({
        path,
        env: typeof flags["env"] === "string" ? flags["env"] : undefined,
        report: report as ReporterName,
        timeout,
        bail: flags["bail"] === true,
        noDb: flags["no-db"] === true,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        authToken: typeof flags["auth-token"] === "string" ? flags["auth-token"] : undefined,
        safe: flags["safe"] === true,
        tag: tags.length > 0 ? tags : undefined,
        envVars: envVarValues.length > 0 ? envVarValues : undefined,
        dryRun: flags["dry-run"] === true,
        json: jsonFlag,
      });
    }

    case "validate": {
      const path = positional[0];
      if (!path) {
        printError("Missing path argument. Usage: zond validate <path>");
        return 2;
      }

      return validateCommand({ path, json: jsonFlag });
    }

    case "ui":
    case "serve": {
      const portRaw = flags["port"];
      let port: number | undefined;
      if (typeof portRaw === "string") {
        port = parseInt(portRaw, 10);
        if (isNaN(port) || port <= 0) {
          printError(`Invalid port value: ${portRaw}`);
          return 2;
        }
      }
      return serveCommand({
        port,
        host: typeof flags["host"] === "string" ? flags["host"] : undefined,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        watch: flags["watch"] === true,
        open: command === "ui" || flags["open"] === true,
      });
    }

    case "ci": {
      const ciSub = positional[0];
      if (ciSub !== "init") {
        printError("Usage: zond ci init [--github|--gitlab] [--force]");
        return 2;
      }
      let platform: "github" | "gitlab" | undefined;
      if (flags["github"] === true) platform = "github";
      else if (flags["gitlab"] === true) platform = "gitlab";
      return ciInitCommand({
        platform,
        force: flags["force"] === true,
        dir: typeof flags["dir"] === "string" ? flags["dir"] : undefined,
        json: jsonFlag,
      });
    }

    case "coverage": {
      let spec = flags["spec"] as string | undefined;
      let tests = flags["tests"] as string | undefined;
      const coverageApiFlag = typeof flags["api"] === "string" ? flags["api"] : undefined;

      if (coverageApiFlag) {
        try {
          getDb(typeof flags["db"] === "string" ? flags["db"] : undefined);
          const col = findCollectionByNameOrId(coverageApiFlag);
          if (!col) { printError(`API '${coverageApiFlag}' not found`); return 1; }
          if (!spec && col.openapi_spec) spec = col.openapi_spec;
          if (!tests && col.test_path) tests = col.test_path;
        } catch (err) {
          printError(`Failed to resolve --api: ${(err as Error).message}`);
          return 2;
        }
      }

      if (typeof spec !== "string") {
        printError("Missing --spec <path>. Usage: zond coverage --spec <path> --tests <dir>");
        return 2;
      }
      if (typeof tests !== "string") {
        printError("Missing --tests <dir>. Usage: zond coverage --spec <path> --tests <dir>");
        return 2;
      }
      const failOnCoverageRaw = flags["fail-on-coverage"];
      let failOnCoverage: number | undefined;
      if (typeof failOnCoverageRaw === "string") {
        failOnCoverage = parseInt(failOnCoverageRaw, 10);
        if (isNaN(failOnCoverage) || failOnCoverage < 0 || failOnCoverage > 100) {
          printError(`Invalid --fail-on-coverage value: ${failOnCoverageRaw} (must be 0–100)`);
          return 2;
        }
      }
      const runIdRaw = flags["run-id"];
      let runId: number | undefined;
      if (typeof runIdRaw === "string") {
        runId = parseInt(runIdRaw, 10);
        if (isNaN(runId)) {
          printError(`Invalid --run-id value: ${runIdRaw} (must be a number)`);
          return 2;
        }
      }
      return coverageCommand({ spec, tests, failOnCoverage, runId, json: jsonFlag });
    }

    case "init": {
      return initCommand({
        name: typeof flags["name"] === "string" ? flags["name"] : undefined,
        spec: typeof flags["spec"] === "string" ? flags["spec"] : positional[0],
        baseUrl: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined,
        dir: typeof flags["dir"] === "string" ? flags["dir"] : undefined,
        force: flags["force"] === true,
        insecure: flags["insecure"] === true,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        json: jsonFlag,
      });
    }

    case "describe": {
      const specPath = positional[0];
      if (!specPath) {
        printError("Missing spec path. Usage: zond describe <spec> [--compact | --method <M> --path <P>]");
        return 2;
      }
      return describeCommand({
        specPath,
        compact: flags["compact"] === true,
        method: typeof flags["method"] === "string" ? flags["method"] : undefined,
        path: typeof flags["path"] === "string" ? flags["path"] : undefined,
        json: jsonFlag,
      });
    }

    case "db": {
      const dbSub = positional[0];
      if (!dbSub) {
        printError("Missing subcommand. Usage: zond db <collections|runs|run|diagnose|compare> [args]");
        return 2;
      }
      const limitRaw = flags["limit"];
      let limit: number | undefined;
      if (typeof limitRaw === "string") {
        limit = parseInt(limitRaw, 10);
        if (isNaN(limit) || limit <= 0) limit = undefined;
      }
      return dbCommand({
        subcommand: dbSub,
        positional: positional.slice(1),
        limit,
        verbose: flags["verbose"] === true,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        json: jsonFlag,
      });
    }

    case "request": {
      const method = positional[0];
      const url = positional[1];
      if (!method || !url) {
        printError("Missing arguments. Usage: zond request <METHOD> <URL> [--header H] [--body JSON]");
        return 2;
      }
      // Collect all --header flags
      const headerValues: string[] = [];
      const rawArgs = process.argv.slice(2);
      for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i]!;
        if (arg === "--header" && rawArgs[i + 1]) {
          headerValues.push(rawArgs[i + 1]!);
          i++;
        } else if (arg.startsWith("--header=")) {
          headerValues.push(arg.slice("--header=".length));
        }
      }

      const timeoutRaw = flags["timeout"];
      let timeout: number | undefined;
      if (typeof timeoutRaw === "string") {
        timeout = parseInt(timeoutRaw, 10);
        if (isNaN(timeout) || timeout <= 0) timeout = undefined;
      }

      return requestCommand({
        method,
        url,
        headers: headerValues.length > 0 ? headerValues : undefined,
        body: typeof flags["body"] === "string" ? flags["body"] : undefined,
        timeout,
        env: typeof flags["env"] === "string" ? flags["env"] : undefined,
        api: typeof flags["api"] === "string" ? flags["api"] : undefined,
        jsonPath: typeof flags["json-path"] === "string" ? flags["json-path"] : undefined,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        json: jsonFlag,
      });
    }

    case "generate": {
      const specPath = positional[0];
      if (!specPath) {
        printError("Missing spec path. Usage: zond generate <spec> --output <dir> [--tag <tag>] [--uncovered-only] [--json]");
        return 2;
      }
      const output = typeof flags["output"] === "string" ? flags["output"] : undefined;
      if (!output) {
        printError("Missing --output <dir>. Usage: zond generate <spec> --output <dir>");
        return 2;
      }
      return generateCommand({
        specPath,
        output,
        tag: typeof flags["tag"] === "string" ? flags["tag"] : undefined,
        uncoveredOnly: flags["uncovered-only"] === true,
        json: jsonFlag,
      });
    }

    case "guide": {
      const specPath = positional[0];
      if (!specPath) {
        printError("Missing spec path. Usage: zond guide <spec> [--tests-dir <dir>] [--tag <tag>]");
        return 2;
      }
      return guideCommand({
        specPath,
        testsDir: typeof flags["tests-dir"] === "string" ? flags["tests-dir"] : undefined,
        tag: typeof flags["tag"] === "string" ? flags["tag"] : undefined,
        json: jsonFlag,
      });
    }

    default: {
      printError(`Unknown command: ${command}`);
      printUsage();
      return 2;
    }
  }
}

// Only run when executed directly, not when imported
const scriptPath = process.argv[1]?.replaceAll("\\", "/") ?? "";
const metaFile = import.meta.filename?.replaceAll("\\", "/") ?? "";
const isMain = scriptPath === metaFile
  || scriptPath.endsWith("cli/index.ts")
  || import.meta.main === true;
if (isMain) {
  try {
    const code = await main();
    process.exitCode = code;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
}
