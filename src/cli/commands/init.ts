import { setupApi, type SetupApiResult } from "../../core/setup-api.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { bootstrapWorkspace, type BootstrapResult, type Integration } from "./init/bootstrap.ts";

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
  integration?: Integration;
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
  const integration: Integration = options.integration ?? "mcp";

  try {
    if (mode === "register") {
      const result = await registerApi(options);
      printRegisterResult(options, result);
      return 0;
    }

    const bootstrap = bootstrapWorkspace({ integration, cwd: options.cwd, home: options.home });
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
        mcpInstalled: bootstrap.mcpInstalled,
        integration,
      };
      if (register) {
        data.collectionId = register.collectionId;
        data.baseDir = register.baseDir;
        data.testPath = register.testPath;
        data.endpoints = register.specEndpoints;
      }
      printJson(jsonOk("init", data, [...bootstrap.warnings, ...(register?.warnings ?? [])]));
    } else {
      printBootstrapResult(bootstrap, integration);
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

function printBootstrapResult(b: BootstrapResult, integration: Integration): void {
  const lines: string[] = [];
  lines.push(`  ${verb(b.configAction)} zond.config.yml`);
  lines.push(`  ${verb(b.apisAction)} apis/`);
  if (b.agents) lines.push(`  ${verb(b.agents.action)} AGENTS.md (${integration})`);
  for (const r of b.mcpInstalled) {
    lines.push(`  ${verb(r.action)} ${r.configPath}`);
  }
  for (const w of b.warnings) {
    process.stderr.write(`Warning: ${w}\n`);
  }
  process.stdout.write(lines.join("\n") + "\n");
  if (integration === "skip") {
    printSuccess("Workspace ready. Run `zond init --spec <path>` to register your first API.");
  } else if (integration === "mcp") {
    printSuccess("Workspace ready. Restart your MCP client (Claude Code / Cursor) to pick up the zond server.");
  } else {
    printSuccess("Workspace ready. See AGENTS.md for the CLI workflow.");
  }
}

function verb(action: "created" | "updated" | "noop"): string {
  return action === "created" ? "Created" : action === "updated" ? "Updated" : "Up-to-date:";
}
