#!/usr/bin/env bun

import { runCommand } from "./commands/run.ts";
import { validateCommand } from "./commands/validate.ts";
import { printError } from "./output.ts";
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

Options for 'run':
  --env <name>         Use environment file (.env.<name>.yaml)
  --report <format>    Output format: console, json (default: console)
  --timeout <ms>       Override request timeout
  --bail               Stop on first suite failure

General:
  --help, -h           Show this help
  --version, -v        Show version`);
}

const VALID_REPORTERS = new Set<string>(["console", "json"]);

async function main(): Promise<number> {
  const { command, positional, flags } = parseArgs(process.argv);

  // Help
  if (command === "help" || command === "--help" || flags["help"] === true || flags["h"] === true) {
    printUsage();
    return 0;
  }

  // Version
  if (command === "--version" || flags["version"] === true || flags["v"] === true) {
    console.log("apitool 0.1.0");
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
        printError(`Unknown reporter: ${report}. Available: console, json`);
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
const isMain = scriptPath === metaFile || scriptPath.endsWith("cli/index.ts");
if (isMain) {
  try {
    const code = await main();
    process.exitCode = code;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
}
