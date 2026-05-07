import { Command } from "commander";

import { registerRun } from "./commands/run.ts";
import { registerValidate } from "./commands/validate.ts";
import { registerServe } from "./commands/serve.ts";
import { registerCoverage } from "./commands/coverage.ts";
import { registerCi } from "./commands/ci-init.ts";
import { registerClean } from "./commands/clean.ts";
import { registerInit } from "./commands/init/index.ts";
import { registerDescribe } from "./commands/describe.ts";
import { registerDb } from "./commands/db.ts";
import { registerRequest } from "./commands/request.ts";
import { registerGenerate } from "./commands/generate.ts";
import { registerDiscover } from "./commands/discover.ts";
import {
  registerProbes,
  registerProbeAliasesEarly,
  registerProbeMethodsAlias,
} from "./commands/probe.ts";
import { registerLintSpec } from "./commands/lint-spec.ts";
import { registerExport } from "./commands/export.ts";
import { registerReport } from "./commands/report.ts";
import { registerUpdate } from "./commands/update.ts";
import { registerCatalog } from "./commands/catalog.ts";
import { registerCompletions } from "./commands/completions.ts";
import { registerUse } from "./commands/use.ts";
import { registerSession } from "./commands/session.ts";
import { registerDoctor } from "./commands/doctor.ts";
import { registerRefreshApi } from "./commands/refresh-api.ts";
import { registerAdd } from "./commands/add-api.ts";

import { getSecretRegistry } from "../core/secrets/registry.ts";
import { getRuntimeInfo } from "./runtime.ts";
import { VERSION } from "./version.ts";
import { preprocessArgv } from "./argv.ts";

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

  registerRun(program);

  registerValidate(program);

  registerServe(program);

  registerCi(program);

  registerUse(program);
  registerRefreshApi(program);
  registerDoctor(program);

  registerSession(program);
  registerCoverage(program);

  registerInit(program);
  registerAdd(program);

  registerDescribe(program);
  registerDb(program);
  registerRequest(program);

  registerClean(program);

  registerGenerate(program);
  registerDiscover(program);

  registerProbes(program);
  registerProbeAliasesEarly(program);

  registerLintSpec(program);
  registerProbeMethodsAlias(program);
  registerCatalog(program);
  registerExport(program);
  registerReport(program);

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
