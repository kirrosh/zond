#!/usr/bin/env bun

import { CommanderError } from "commander";
import { buildProgram, preprocessArgv } from "./program.ts";
import { printError } from "./output.ts";
import { VERSION } from "./version.ts";

export { VERSION };

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
    printError(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
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
