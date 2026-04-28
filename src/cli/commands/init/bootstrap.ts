import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { upsertAgentsBlock, type AgentsBlockResult } from "./agents-md.ts";
import zondConfigTemplate from "./templates/zond-config.yml" with { type: "text" };

export type Integration = "cli" | "skip";

export interface BootstrapOptions {
  cwd?: string;
  integration: Integration;
  /** Override $HOME — used by tests and intentional overrides. */
  home?: string;
  dryRun?: boolean;
}

export interface BootstrapResult {
  cwd: string;
  configPath: string;
  configAction: "created" | "noop";
  apisDir: string;
  apisAction: "created" | "noop";
  agents: AgentsBlockResult | null;
  warnings: string[];
}

/**
 * Idempotent workspace bootstrap. Creates `zond.config.yml`, `apis/`, and
 * (depending on `integration`) `AGENTS.md`.
 */
export function bootstrapWorkspace(opts: BootstrapOptions): BootstrapResult {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const warnings: string[] = [];

  // 1. zond.config.yml
  const configPath = join(cwd, "zond.config.yml");
  let configAction: "created" | "noop" = "noop";
  if (!existsSync(configPath)) {
    if (!opts.dryRun) writeFileSync(configPath, zondConfigTemplate, "utf-8");
    configAction = "created";
  }

  // 2. apis/
  const apisDir = join(cwd, "apis");
  let apisAction: "created" | "noop" = "noop";
  if (!existsSync(apisDir)) {
    if (!opts.dryRun) mkdirSync(apisDir, { recursive: true });
    apisAction = "created";
  }

  // 3. AGENTS.md (only cli)
  let agents: AgentsBlockResult | null = null;
  if (opts.integration === "cli") {
    if (!opts.dryRun) {
      agents = upsertAgentsBlock(cwd, opts.integration);
    } else {
      agents = { path: join(cwd, "AGENTS.md"), action: existsSync(join(cwd, "AGENTS.md")) ? "updated" : "created" };
    }
  }

  return {
    cwd,
    configPath,
    configAction,
    apisDir,
    apisAction,
    agents,
    warnings,
  };
}
