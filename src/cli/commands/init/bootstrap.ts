import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { upsertAgentsBlock, type AgentsBlockResult } from "./agents-md.ts";
import {
  detectStaleSkills,
  pruneStaleSkills,
  upsertSkills,
  type SkillResult,
  type StaleSkill,
} from "./skills.ts";
import zondConfigTemplate from "./templates/zond-config.yml" with { type: "text" };

export interface BootstrapOptions {
  cwd?: string;
  /** Whether to write/upsert AGENTS.md. Defaults to true. */
  writeAgents?: boolean;
  /** Whether to write Claude Code skills under .claude/skills/. Defaults to true. */
  writeSkills?: boolean;
  /** Remove legacy skill dirs (zond-base, zond-scenarios, …) instead of just warning. */
  pruneStaleSkills?: boolean;
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
  skills: SkillResult[];
  /** Legacy skill dirs that exist on disk but are no longer in `SKILLS`. */
  staleSkills: StaleSkill[];
  /** Subset of `staleSkills` that were actually removed (empty unless `pruneStaleSkills`). */
  prunedSkills: StaleSkill[];
  warnings: string[];
}

/**
 * Idempotent workspace bootstrap. Creates `zond.config.yml`, `apis/`, and
 * (unless `writeAgents` is false) `AGENTS.md`.
 */
export function bootstrapWorkspace(opts: BootstrapOptions = {}): BootstrapResult {
  // Honor ZOND_WORKSPACE so `zond init` writes the workspace at the same root
  // that findWorkspaceRoot() reads from (headless/CI runs anchor both here).
  // Explicit opts.cwd (tests) still wins.
  const cwd = resolve(opts.cwd ?? process.env.ZOND_WORKSPACE?.trim() ?? process.cwd());
  const warnings: string[] = [];
  const writeAgents = opts.writeAgents ?? true;
  const writeSkills = opts.writeSkills ?? true;

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

  // 3. AGENTS.md
  let agents: AgentsBlockResult | null = null;
  if (writeAgents) {
    if (!opts.dryRun) {
      agents = upsertAgentsBlock(cwd);
    } else {
      agents = { path: join(cwd, "AGENTS.md"), action: existsSync(join(cwd, "AGENTS.md")) ? "updated" : "created" };
    }
  }

  // 4. .claude/skills/zond-*/SKILL.md
  const skills: SkillResult[] = writeSkills ? upsertSkills(cwd, { dryRun: opts.dryRun }) : [];

  // 5. Detect (and optionally prune) legacy skill dirs left over from
  // retired templates. User-authored skill dirs are NOT touched —
  // only names in `LEGACY_SKILL_NAMES` are considered.
  const staleSkills = writeSkills ? detectStaleSkills(cwd) : [];
  let prunedSkills: StaleSkill[] = [];
  if (writeSkills && opts.pruneStaleSkills && staleSkills.length > 0) {
    prunedSkills = pruneStaleSkills(cwd, { dryRun: opts.dryRun });
  } else if (staleSkills.length > 0) {
    for (const { name } of staleSkills) {
      warnings.push(
        `stale skill detected: .claude/skills/${name}/ — re-run with --prune-stale-skills to remove`,
      );
    }
  }

  return {
    cwd,
    configPath,
    configAction,
    apisDir,
    apisAction,
    agents,
    skills,
    staleSkills,
    prunedSkills,
    warnings,
  };
}
