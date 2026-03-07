#!/usr/bin/env bun

import { runCommand } from "./commands/run.ts";
import { validateCommand } from "./commands/validate.ts";
import { serveCommand } from "./commands/serve.ts";
import { collectionsCommand } from "./commands/collections.ts";
import { aiGenerateCommand } from "./commands/ai-generate.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { initCommand } from "./commands/init.ts";
import { updateCommand } from "./commands/update.ts";
import { chatCommand } from "./commands/chat.ts";
import { runsCommand } from "./commands/runs.ts";
import { coverageCommand } from "./commands/coverage.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { addApiCommand } from "./commands/add-api.ts";
import { ciInitCommand } from "./commands/ci-init.ts";
import { compareCommand } from "./commands/compare.ts";
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
        flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = next;
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
  zond add-api <name>   Register a new API (collection)
  zond run <path>       Run API tests
  zond validate <path>  Validate test files without running
  zond ai-generate --from <spec> --prompt "..."  Generate tests with AI
  zond runs [id]        View test run history
  zond coverage --spec <path> --tests <dir>  Analyze API test coverage
  zond collections      List test collections
  zond serve            Start web dashboard
  zond init             Initialize a new zond project
  zond ci init          Generate CI/CD workflow (GitHub Actions, GitLab CI)
  zond mcp              Start MCP server (stdio transport for AI agents)
                           --dir <path>  Set working directory (relative paths resolve here)
  zond chat             Start interactive AI chat for API testing
  zond compare <runA> <runB>  Compare two test runs (regressions/fixes)
  zond doctor           Run diagnostic checks
  zond update           Update to latest version

Options for 'add-api':
  --spec <path-or-url>   OpenAPI spec (extracts base_url from servers[0])
  --dir <directory>      Base directory (default: ./apis/<name>/)
  --env key=value        Set environment variables (repeatable)
  --insecure             Skip TLS verification (self-signed certs)

Options for 'chat':
  --provider <name>    LLM provider: ollama, openai, anthropic, custom (default: ollama)
  --model <name>       Model name (default: provider-specific)
  --api-key <key>      API key (or set ZOND_AI_KEY env var)
  --base-url <url>     Provider base URL override
  --safe               Only allow running GET tests (read-only mode)

Options for 'runs':
  runs                 List recent test runs
  runs <id>            Show run details with step results
  --limit <n>          Number of runs to show (default: 20)

Options for 'compare':
  compare <runA> <runB>   Compare two run IDs
  Exit code 1 if regressions found, 0 otherwise

Options for 'coverage':
  --api <name>         Use API collection (auto-resolves spec and tests dir)
  --spec <path>        Path to OpenAPI spec (required unless --api used)
  --tests <dir>        Path to test files directory (required unless --api used)
  --fail-on-coverage N Exit 1 when coverage percentage is below N (0–100)
  --run-id <number>    Cross-reference with a test run for pass/fail/5xx breakdown

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

Options for 'ai-generate':
  --api <name>         Use API collection (auto-resolves spec and output dir)
  --from <spec>        Path to OpenAPI spec (required unless --api used)
  --prompt <text>      Test scenario description (required)
  --provider <name>    LLM provider: ollama, openai, anthropic, custom (default: ollama)
  --model <name>       Model name (default: provider-specific)
  --api-key <key>      API key (or set ZOND_AI_KEY env var)
  --base-url <url>     Provider base URL override
  --output <dir>       Output directory (default: ./generated/ai/)

Options for 'serve':
  --port <port>        Server port (default: 8080)
  --host <host>        Server host (default: 0.0.0.0)
  --openapi <spec>     Path to OpenAPI spec for Explorer
  --db <path>          Path to SQLite database file (default: zond.db)
  --watch              Enable dev mode with hot reload (auto-refresh browser on file changes)

Options for 'ci init':
  --github             Generate GitHub Actions workflow
  --gitlab             Generate GitLab CI config
  --dir <path>         Project root directory (default: current directory)
  --force              Overwrite existing CI config

General:
  --help, -h           Show this help
  --version, -v        Show version`);
}

const VALID_REPORTERS = new Set<string>(["console", "json", "junit"]);

async function main(): Promise<number> {
  const { command, positional, flags } = parseArgs(process.argv);

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
    case "add-api": {
      const name = positional[0];
      if (!name) {
        printError("Missing name argument. Usage: zond add-api <name> [--spec <path>] [--dir <dir>]");
        return 2;
      }

      // Collect all --env flags (parseArgs only stores last one, so re-parse)
      const envValues: string[] = [];
      const rawArgs = process.argv.slice(2);
      for (let i = 0; i < rawArgs.length; i++) {
        if (rawArgs[i] === "--env" && rawArgs[i + 1] && rawArgs[i + 1]!.includes("=")) {
          envValues.push(rawArgs[i + 1]!);
          i++;
        } else if (rawArgs[i]?.startsWith("--env=") && rawArgs[i]!.slice(6).includes("=")) {
          envValues.push(rawArgs[i]!.slice(6));
        }
      }

      return addApiCommand({
        name,
        spec: typeof flags["spec"] === "string" ? flags["spec"] : undefined,
        dir: typeof flags["dir"] === "string" ? flags["dir"] : undefined,
        envPairs: envValues.length > 0 ? envValues : undefined,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        insecure: flags["insecure"] === true,
      });
    }

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
      });
    }

    case "validate": {
      const path = positional[0];
      if (!path) {
        printError("Missing path argument. Usage: zond validate <path>");
        return 2;
      }

      return validateCommand({ path });
    }

    case "ai-generate": {
      let from = flags["from"] as string | undefined;
      let output = typeof flags["output"] === "string" ? flags["output"] : undefined;
      const aiGenApiFlag = typeof flags["api"] === "string" ? flags["api"] : undefined;

      // Resolve --api to spec and output dir from collection
      if (aiGenApiFlag) {
        try {
          getDb(typeof flags["db"] === "string" ? flags["db"] : undefined);
          const col = findCollectionByNameOrId(aiGenApiFlag);
          if (!col) { printError(`API '${aiGenApiFlag}' not found`); return 1; }
          if (!from && col.openapi_spec) from = col.openapi_spec;
          if (!output && col.test_path) output = col.test_path;
        } catch (err) {
          printError(`Failed to resolve --api: ${(err as Error).message}`);
          return 2;
        }
      }

      if (typeof from !== "string") {
        printError("Missing --from <spec>. Usage: zond ai-generate --from <spec> --prompt \"...\"");
        return 2;
      }
      const prompt = flags["prompt"];
      if (typeof prompt !== "string") {
        printError("Missing --prompt <text>. Usage: zond ai-generate --from <spec> --prompt \"...\"");
        return 2;
      }
      return aiGenerateCommand({
        from,
        prompt,
        provider: typeof flags["provider"] === "string" ? flags["provider"] : "ollama",
        model: typeof flags["model"] === "string" ? flags["model"] : undefined,
        apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
        baseUrl: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined,
        output,
      });
    }

    case "collections": {
      return collectionsCommand(
        typeof flags["db"] === "string" ? flags["db"] : undefined,
      );
    }

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
        openapiSpec: typeof flags["openapi"] === "string" ? flags["openapi"] : undefined,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        watch: flags["watch"] === true,
      });
    }

    case "init": {
      return initCommand({
        force: flags["force"] === true,
      });
    }

    case "mcp": {
      return mcpCommand({
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        dir: typeof flags["dir"] === "string" ? flags["dir"] : undefined,
      });
    }

    case "chat": {
      return chatCommand({
        provider: typeof flags["provider"] === "string" ? flags["provider"] : undefined,
        model: typeof flags["model"] === "string" ? flags["model"] : undefined,
        apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
        baseUrl: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined,
        safe: flags["safe"] === true,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
      });
    }

    case "update": {
      return updateCommand({ force: flags["force"] === true });
    }

    case "runs": {
      const idRaw = positional[0];
      let runId: number | undefined;
      if (idRaw) {
        runId = parseInt(idRaw, 10);
        if (isNaN(runId)) {
          printError(`Invalid run ID: ${idRaw}`);
          return 2;
        }
      }

      const limitRaw = flags["limit"];
      let limit: number | undefined;
      if (typeof limitRaw === "string") {
        limit = parseInt(limitRaw, 10);
        if (isNaN(limit) || limit <= 0) {
          printError(`Invalid limit value: ${limitRaw}`);
          return 2;
        }
      }

      return runsCommand({
        runId,
        limit,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
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
      });
    }

    case "compare": {
      const rawA = positional[0];
      const rawB = positional[1];
      if (!rawA || !rawB) {
        printError("Usage: zond compare <runA> <runB>");
        return 2;
      }
      const runA = parseInt(rawA, 10);
      const runB = parseInt(rawB, 10);
      if (isNaN(runA) || isNaN(runB)) {
        printError("Run IDs must be integers");
        return 2;
      }
      return compareCommand({
        runA,
        runB,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
      });
    }

    case "doctor": {
      return doctorCommand({
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
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
      return coverageCommand({ spec, tests, failOnCoverage, runId });
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
