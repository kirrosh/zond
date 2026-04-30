#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { CommanderError } from "commander";
import { buildProgram, preprocessArgv } from "./program.ts";
import { VERSION } from "./version.ts";

export { VERSION };

/**
 * Anything that reaches this handler is an *unexpected* throw — command
 * implementations are expected to catch their own usage/config errors and
 * return exit 2 themselves. Tag these with `[zond:internal]` so operators
 * can tell them apart from sandbox/SIGKILL/OOM (137/143). See ZOND.md →
 * "Exit codes" for the full taxonomy.
 */
function reportInternalError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : message;
  const stackHash = createHash("sha1").update(stack).digest("hex").slice(0, 8);
  process.stderr.write(`[zond:internal] zond ${VERSION} — uncaught ${message} (stack ${stackHash})\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(preprocessArgv(process.argv));
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help/version — commander prints content itself, exit 0
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version" || err.code === "commander.help") {
        process.exitCode = 0;
        return;
      }
      // Unknown command / unknown option / missing argument — exit 2 (already printed by commander/showHelpAfterError)
      process.exitCode = 2;
      return;
    }
    reportInternalError(err);
    process.exitCode = 3;
  }
}

const scriptPath = process.argv[1]?.replaceAll("\\", "/") ?? "";
const metaFile = import.meta.filename?.replaceAll("\\", "/") ?? "";
const isMain = scriptPath === metaFile
  || scriptPath.endsWith("cli/index.ts")
  || import.meta.main === true;

if (isMain) {
  await main();
}
