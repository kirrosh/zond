#!/usr/bin/env bun

import { runCommand } from "./commands/run.ts";
import { validateCommand } from "./commands/validate.ts";
import { generateCommand } from "./commands/generate.ts";
import { serveCommand } from "./commands/serve.ts";
import { collectionsCommand } from "./commands/collections.ts";
import { aiGenerateCommand } from "./commands/ai-generate.ts";
import { printError } from "./output.ts";
import { getRuntimeInfo } from "./runtime.ts";
import type { ReporterName } from "../core/reporter/types.ts";

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
  console.log(`apitool - API Testing Platform

Usage:
  apitool run <path>       Run API tests
  apitool validate <path>  Validate test files without running
  apitool generate --from <spec>  Generate skeleton tests from OpenAPI spec
  apitool ai-generate --from <spec> --prompt "..."  Generate tests with AI
  apitool collections      List test collections
  apitool serve            Start web dashboard

Options for 'run':
  --env <name>         Use environment file (.env.<name>.yaml)
  --report <format>    Output format: console, json, junit (default: console)
  --timeout <ms>       Override request timeout
  --bail               Stop on first suite failure
  --no-db              Do not save results to apitool.db
  --db <path>          Path to SQLite database file (default: apitool.db)
  --auth-token <token> Auth token injected as {{auth_token}} variable

Options for 'ai-generate':
  --from <spec>        Path to OpenAPI spec (required)
  --prompt <text>      Test scenario description (required)
  --provider <name>    LLM provider: ollama, openai, anthropic, custom (default: ollama)
  --model <name>       Model name (default: provider-specific)
  --api-key <key>      API key (or set APITOOL_AI_KEY env var)
  --base-url <url>     Provider base URL override
  --output <dir>       Output directory (default: ./generated/ai/)

Options for 'serve':
  --port <port>        Server port (default: 8080)
  --host <host>        Server host (default: 0.0.0.0)
  --openapi <spec>     Path to OpenAPI spec for Explorer
  --db <path>          Path to SQLite database file (default: apitool.db)

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
    console.log(`apitool 0.1.0 (${getRuntimeInfo()})`);
    return 0;
  }

  if (!command) {
    printUsage();
    return 0;
  }

  switch (command) {
    case "run": {
      const path = positional[0];
      if (!path) {
        printError("Missing path argument. Usage: apitool run <path>");
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

      return runCommand({
        path,
        env: typeof flags["env"] === "string" ? flags["env"] : undefined,
        report: report as ReporterName,
        timeout,
        bail: flags["bail"] === true,
        noDb: flags["no-db"] === true,
        dbPath: typeof flags["db"] === "string" ? flags["db"] : undefined,
        authToken: typeof flags["auth-token"] === "string" ? flags["auth-token"] : undefined,
      });
    }

    case "validate": {
      const path = positional[0];
      if (!path) {
        printError("Missing path argument. Usage: apitool validate <path>");
        return 2;
      }

      return validateCommand({ path });
    }

    case "generate": {
      const from = flags["from"];
      if (typeof from !== "string") {
        printError("Missing --from <spec> argument. Usage: apitool generate --from <spec>");
        return 2;
      }
      const output = typeof flags["output"] === "string" ? flags["output"] : "./generated/";
      return generateCommand({ from, output });
    }

    case "ai-generate": {
      const from = flags["from"];
      if (typeof from !== "string") {
        printError("Missing --from <spec>. Usage: apitool ai-generate --from <spec> --prompt \"...\"");
        return 2;
      }
      const prompt = flags["prompt"];
      if (typeof prompt !== "string") {
        printError("Missing --prompt <text>. Usage: apitool ai-generate --from <spec> --prompt \"...\"");
        return 2;
      }
      return aiGenerateCommand({
        from,
        prompt,
        provider: typeof flags["provider"] === "string" ? flags["provider"] : "ollama",
        model: typeof flags["model"] === "string" ? flags["model"] : undefined,
        apiKey: typeof flags["api-key"] === "string" ? flags["api-key"] : undefined,
        baseUrl: typeof flags["base-url"] === "string" ? flags["base-url"] : undefined,
        output: typeof flags["output"] === "string" ? flags["output"] : undefined,
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
