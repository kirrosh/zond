import { Command } from "commander";

import { registerRun } from "./commands/run.ts";
import { registerCheck } from "./commands/check.ts";
import { registerCoverage } from "./commands/coverage.ts";
import { registerCi } from "./commands/ci-init.ts";
import { registerClean } from "./commands/clean.ts";
import { registerCleanup } from "./commands/cleanup.ts";
import { registerInit } from "./commands/init/index.ts";
import { registerDescribe } from "./commands/describe.ts";
import { registerDb } from "./commands/db.ts";
import { registerRequest } from "./commands/request.ts";
import { registerGenerate } from "./commands/generate.ts";
import { registerPrepareFixtures } from "./commands/prepare-fixtures.ts";
import { registerProbes } from "./commands/probe.ts";
import { registerReport } from "./commands/report.ts";
import { registerCatalog } from "./commands/catalog.ts";
import { registerCompletions } from "./commands/completions.ts";
import { registerUse } from "./commands/use.ts";
import { registerSession } from "./commands/session.ts";
import { registerDoctor } from "./commands/doctor.ts";
import { registerRefreshApi } from "./commands/refresh-api.ts";
import { registerAdd } from "./commands/add-api.ts";
import { registerAudit } from "./commands/audit.ts";
import { registerReference } from "./commands/reference.ts";

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
    .option(
      "--api <name>",
      "TASK-290: Select the active API for this invocation. Resolution order: per-command --api > global --api (this flag) > ZOND_API env > .zond/current-api file (set via `zond use <name>`).",
    )
    .hook("preAction", (thisCommand) => {
      const enabled = thisCommand.opts().redact !== false;
      // Mirror the flag into env so deeply-nested code that doesn't have
      // access to `cmd` (e.g. setup-api, exporters) can still consult it.
      process.env.ZOND_REDACT = enabled ? "1" : "0";
      getSecretRegistry().setEnabled(enabled);
      // TASK-290: mirror the global --api flag into env so the resolution
      // chain in core/context/current.ts (which has no `cmd` ref) sees it.
      // Per-command --api still wins because it is passed positionally to
      // resolveSpecArg / resolveApiCollection.
      const apiGlobal = thisCommand.opts().api;
      if (typeof apiGlobal === "string" && apiGlobal.length > 0) {
        process.env.ZOND_API_GLOBAL = apiGlobal;
      } else {
        delete process.env.ZOND_API_GLOBAL;
      }
    });

  registerRun(program);

  registerCheck(program);

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
  registerCleanup(program);

  registerGenerate(program);
  registerPrepareFixtures(program);
  registerAudit(program);

  registerProbes(program);

  registerCatalog(program);
  registerReport(program);

  registerCompletions(program);
  registerReference(program);

  // TASK-267: group top-level commands by phase in `zond --help`. Without
  // grouping, the flat 20+ command list buries the workflow shape; with it,
  // a new tester can see "setup → generate → run → analyze → report" at a
  // glance. Commands not listed below stay in the default group.
  const HELP_GROUPS: Record<string, string> = {
    // setup: register an API, prepare workspace
    "init":         "Setup:",
    "add":          "Setup:",
    "use":          "Setup:",
    "refresh-api":  "Setup:",
    "doctor":       "Setup:",
    "clean":        "Setup:",
    "cleanup":      "Setup:",
    // generate: produce suites/probes from the spec
    "generate":         "Generate:",
    "prepare-fixtures": "Generate:",
    "probe":            "Generate:",
    // run: execute suites against a live API
    "run":     "Run:",
    "session": "Run:",
    "request": "Run:",
    // analyze: post-run inspection and triage
    "coverage": "Analyze:",
    "db":       "Analyze:",
    "audit":    "Analyze:",
    "check":    "Analyze:",
    "describe": "Analyze:",
    // report: outbound artefacts (HTML, bundles, catalog)
    "report":  "Report:",
    "catalog": "Report:",
    // other: scaffolding / shell integration
    "ci":          "Other:",
    "completions": "Other:",
    "reference":   "Other:",
  };
  for (const sub of program.commands) {
    const group = HELP_GROUPS[sub.name()];
    if (group) sub.helpGroup(group);
  }

  // TASK-73: previously `--json` was a top-level/global option that propagated
  // to every subcommand, which collided with `run --report json` (and broke
  // `run --json` outright). Now it is per-command. Attach `--json` to every
  // subcommand that previously read it via globalJson(), EXCEPT `run` —
  // run's only JSON output path is `--report json`.
  // Skip by fully-qualified path so `db run` (inner) keeps --json while
  // top-level `run` does not.
  const skipJson = new Set(["run", "completions"]);
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

  // TASK-297: stamp every leaf with a "related skill" footer so `zond <cmd>
  // --help` is a single-stop entry point for an agent: discover the flag
  // surface AND know which skill file to open for the workflow context.
  // Mapped by fully-qualified path; `*` matches any unnamed leaf and is
  // tried last.
  const skillFor: Record<string, string> = {
    // probes → audit playbook (skills/scenarios.md drills auth/RBAC chains).
    "probe security": "skills/scenarios.md",
    "probe mass-assignment": "skills/scenarios.md",
    "audit": "skills/scenarios.md",
    // db family — failure triage workflow. Will point at skills/zond-triage.md
    // once TASK-302 lands; for now Phase 4 of skills/zond.md covers it.
  };
  const attachHelp = (cmd: Command, parentPath: string): void => {
    const path = parentPath ? `${parentPath} ${cmd.name()}` : cmd.name();
    const hasAction = (cmd as unknown as { _actionHandler?: unknown })._actionHandler != null;
    if (hasAction) {
      const skill = skillFor[path] ?? "skills/zond.md";
      cmd.addHelpText("after", `\nRelated skill: ${skill}`);
    }
    for (const sub of cmd.commands) attachHelp(sub, path);
  };
  for (const sub of program.commands) attachHelp(sub, "");

  return program;
}
