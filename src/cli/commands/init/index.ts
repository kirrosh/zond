import { existsSync, readdirSync } from "node:fs";
import { setupApi, type SetupApiResult } from "../../../core/setup-api.ts";
import { printError, printSuccess } from "../../output.ts";
import { jsonOk, jsonError, printJson } from "../../json-envelope.ts";
import { bootstrapWorkspace, type BootstrapResult } from "./bootstrap.ts";

export interface InitOptions {
  // register-an-API options (existing)
  name?: string;
  spec?: string;
  baseUrl?: string;
  dir?: string;
  force?: boolean;
  insecure?: boolean;
  dbPath?: string;
  json?: boolean;

  // workspace bootstrap (new)
  workspace?: boolean;
  withSpec?: string;
  /** Skip writing AGENTS.md. */
  noAgents?: boolean;
  /** Skip writing Claude Code skills under .claude/skills/. */
  noSkills?: boolean;
  /** Remove legacy skill dirs (zond-base, zond-scenarios, …) — by default a warning is printed. */
  pruneStaleSkills?: boolean;
  /** Override cwd for bootstrap (used by tests; CLI always uses process.cwd()). */
  cwd?: string;
  /** Override $HOME for MCP install (used by tests). */
  home?: string;
}

type InitMode = "register" | "workspace" | "bootstrap+register";

function resolveMode(options: InitOptions): InitMode {
  if (options.spec) return "register";
  if (options.withSpec) return "bootstrap+register";
  return "workspace";
}

export async function initCommand(options: InitOptions): Promise<number> {
  // Reject conflicting combos
  if (options.spec && options.workspace) {
    const msg = "Cannot use --spec and --workspace together. Use --with-spec to bootstrap and register in one step.";
    if (options.json) printJson(jsonError("init", [msg]));
    else printError(msg);
    return 2;
  }

  const mode = resolveMode(options);
  const writeAgents = !options.noAgents;
  const writeSkills = !options.noSkills;

  try {
    if (mode === "register") {
      const result = await registerApi(options);
      printRegisterResult(options, result);
      return 0;
    }

    const bootstrap = bootstrapWorkspace({
      writeAgents,
      writeSkills,
      pruneStaleSkills: options.pruneStaleSkills,
      cwd: options.cwd,
      home: options.home,
    });
    let register: SetupApiResult | null = null;

    if (mode === "bootstrap+register") {
      register = await registerApi({ ...options, spec: options.withSpec });
    }

    if (options.json) {
      const data: Record<string, unknown> = {
        mode,
        configPath: bootstrap.configPath,
        configAction: bootstrap.configAction,
        apisDir: bootstrap.apisDir,
        apisAction: bootstrap.apisAction,
        agentsPath: bootstrap.agents?.path ?? null,
        agentsAction: bootstrap.agents?.action ?? null,
        skills: bootstrap.skills.map((s) => ({ name: s.name, path: s.path, action: s.action })),
        staleSkills: bootstrap.staleSkills.map((s) => ({ name: s.name, path: s.path })),
        prunedSkills: bootstrap.prunedSkills.map((s) => ({ name: s.name, path: s.path })),
      };
      if (register) {
        data.collectionId = register.collectionId;
        data.baseDir = register.baseDir;
        data.testPath = register.testPath;
        data.endpoints = register.specEndpoints;
      }
      printJson(jsonOk("init", data, [...bootstrap.warnings, ...(register?.warnings ?? [])]));
    } else {
      printBootstrapResult(bootstrap, writeAgents);
      if (register) printRegisterResult(options, register);
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("init", [message]));
    else printError(message);
    return 2;
  }
}

async function registerApi(options: InitOptions): Promise<SetupApiResult> {
  const envVars: Record<string, string> = {};
  if (options.baseUrl) envVars.base_url = options.baseUrl;

  return await setupApi({
    name: options.name,
    spec: options.spec ?? options.withSpec,
    dir: options.dir,
    envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
    dbPath: options.dbPath,
    force: options.force,
    insecure: options.insecure,
  });
}

function printRegisterResult(options: InitOptions, result: SetupApiResult): void {
  if (options.json) {
    // Only used by the legacy "register"-only path
    printJson(jsonOk("init", {
      mode: "register",
      collectionId: result.collectionId,
      baseDir: result.baseDir,
      testPath: result.testPath,
      endpoints: result.specEndpoints,
    }, result.warnings));
    return;
  }
  printSuccess(`Created API '${options.name ?? "api"}' at ${result.baseDir} (${result.specEndpoints} endpoints)`);
  if (result.warnings) {
    for (const w of result.warnings) process.stderr.write(`Warning: ${w}\n`);
  }
}

function printBootstrapResult(b: BootstrapResult, writeAgents: boolean): void {
  const lines: string[] = [];
  lines.push(`  ${verb(b.configAction)} zond.config.yml`);
  lines.push(`  ${verb(b.apisAction)} apis/`);
  if (b.agents) lines.push(`  ${verb(b.agents.action)} AGENTS.md`);
  for (const s of b.skills) {
    lines.push(`  ${verb(s.action)} .claude/skills/${s.name}/SKILL.md`);
  }
  for (const s of b.prunedSkills) {
    lines.push(`  Removed .claude/skills/${s.name}/ (stale)`);
  }
  for (const w of b.warnings) {
    process.stderr.write(`Warning: ${w}\n`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  if (!writeAgents) {
    printSuccess("Workspace ready. Run `zond init --spec <path>` to register your first API.");
  } else {
    printSuccess("Workspace ready. See AGENTS.md for the CLI workflow.");
  }
  const apiNames = listExistingApis(b.cwd);
  if (apiNames.length === 0) {
    process.stderr.write(
      `\nNext steps:\n` +
      `  1. zond add api <name> --spec <path|url>   # register API → builds .api-fixtures.yaml (manifest)\n` +
      `  2. zond doctor --api <name>                 # gap report: which vars are UNSET in .env.yaml\n` +
      `  3. zond prepare-fixtures --api <name> --apply   # fill .env.yaml values (single-pass); fill any gaps by hand\n` +
      `  4. zond audit --api <name> --safe           # first read-only pass (GET only — safe against any environment)\n` +
      `\nNote: zond init only refreshes workspace files (skills, AGENTS.md, zond.config.yml).\n` +
      `      It does NOT touch fixtures or .env.yaml — that's the doctor/prepare-fixtures loop above.\n`
    );
  } else {
    const sample = apiNames[0]!;
    process.stderr.write(
      `\nFixtures untouched. zond init only refreshes skills/AGENTS.md/zond.config.yml.\n` +
      `Verify env state with:\n` +
      `  zond doctor --api ${sample} --missing-only   # show UNSET vars + blocked endpoints\n` +
      `  zond prepare-fixtures --api ${sample} --apply   # discover values (single-pass); fill any gaps by hand\n` +
      `  zond audit --api ${sample} --safe            # read-only audit pass (GET only)\n`
    );
  }
}

function listExistingApis(cwd: string): string[] {
  try {
    const apisDir = `${cwd}/apis`;
    if (!existsSync(apisDir)) return [];
    return readdirSync(apisDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(`${apisDir}/${d.name}/spec.json`))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function verb(action: "created" | "updated" | "noop"): string {
  return action === "created" ? "Created" : action === "updated" ? "Updated" : "Up-to-date:";
}

import type { Command } from "commander";
import { globalJson } from "../../resolve.ts";

export function registerInit(program: Command): void {
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
    .option(
      "--prune-stale-skills",
      "Remove .claude/skills/ dirs for retired template names (zond-base, zond-scenarios)",
    )
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const spec = opts.spec ?? specPos;
      const json = globalJson(cmd);
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
        pruneStaleSkills: opts.pruneStaleSkills === true,
        json,
      });
    });
}
