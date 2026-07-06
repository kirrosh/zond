import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import zondSkill from "./templates/skills/zond.md" with { type: "text" };
import checksSkill from "./templates/skills/zond-checks.md" with { type: "text" };
import triageSkill from "./templates/skills/zond-triage.md" with { type: "text" };
import seedSkill from "./templates/skills/zond-seed.md" with { type: "text" };

export interface SkillResult {
  name: string;
  path: string;
  action: "created" | "updated" | "noop";
}

interface SkillTemplate {
  name: string;
  body: string;
}

const SKILLS: SkillTemplate[] = [
  // Primary skill: artifact model + iron rules + full workflow
  // (init → fixtures → annotate → generate → run → stateful checks →
  // probes → coverage → share) + single-flow scenario authoring.
  { name: "zond", body: zondSkill },
  // Depth-check reference: conformance + security + m-20 stateful
  // (cross_call_references, idempotency_replay, pagination_invariants,
  // lifecycle_transitions) with per-aspect annotate flow.
  { name: "zond-checks", body: checksSkill },
  // Read-only triage of a finished run / probe artifact.
  { name: "zond-triage", body: triageSkill },
  // ARV-355: agent-orchestrated auto-seed loop (read gaps → order by
  // fkDependencies → author body → request POST --capture → fix 4xx + retry).
  { name: "zond-seed", body: seedSkill },
];

/**
 * Names previously emitted by `upsertSkills` but no longer in `SKILLS`.
 * Detected as stale by `detectStaleSkills` and removed by
 * `pruneStaleSkills` (only when the user opts in via `--prune-stale-skills`).
 *
 * Append a name here whenever a skill template is retired. User-authored
 * skills (any name NOT in this list) are never touched.
 */
const LEGACY_SKILL_NAMES: readonly string[] = [
  "zond-base",       // retired by skills-consolidation refactor (folded into zond)
  "zond-scenarios",  // retired by skills-consolidation refactor (folded into zond)
] as const;

export interface StaleSkill {
  name: string;
  path: string;
}

/**
 * Per-skill drift status vs the in-binary template. `missing` is
 * non-actionable on its own (user may have intentionally passed
 * `--no-skills`); `outdated` is the actionable one — workspace skill
 * predates a binary upgrade and `zond init` will refresh it.
 */
export type SkillDriftStatus = "fresh" | "outdated" | "missing";

export interface SkillDrift {
  name: string;
  path: string;
  status: SkillDriftStatus;
}

/**
 * Compare each in-binary skill template against the workspace copy at
 * `<cwd>/.claude/skills/<name>/SKILL.md`. Returns one entry per skill —
 * callers filter by status (`outdated` → warn the user to re-run
 * `zond init`).
 */
export function detectSkillDrift(cwd: string): SkillDrift[] {
  return SKILLS.map(({ name, body }) => {
    const path = join(cwd, ".claude", "skills", name, "SKILL.md");
    const desired = body.endsWith("\n") ? body : body + "\n";
    if (!existsSync(path)) return { name, path, status: "missing" as const };
    const current = readFileSync(path, "utf-8");
    return {
      name,
      path,
      status: (current === desired ? "fresh" : "outdated") as SkillDriftStatus,
    };
  });
}

/**
 * Returns directories under `<cwd>/.claude/skills/` whose name is in
 * `LEGACY_SKILL_NAMES`. User-authored skill directories (any other
 * name) are intentionally ignored.
 */
export function detectStaleSkills(cwd: string): StaleSkill[] {
  const out: StaleSkill[] = [];
  for (const name of LEGACY_SKILL_NAMES) {
    const path = join(cwd, ".claude", "skills", name);
    if (existsSync(path)) out.push({ name, path });
  }
  return out;
}

/**
 * Recursively removes the directories returned by `detectStaleSkills`.
 * Returns the list of names that were actually removed.
 */
export function pruneStaleSkills(cwd: string, opts: { dryRun?: boolean } = {}): StaleSkill[] {
  const stale = detectStaleSkills(cwd);
  if (!opts.dryRun) {
    for (const { path } of stale) rmSync(path, { recursive: true, force: true });
  }
  return stale;
}

/**
 * Idempotently writes Claude Code skills into `<cwd>/.claude/skills/<name>/SKILL.md`.
 * Body is identical to the in-binary template — overwrites on drift, noop on match.
 */
export function upsertSkills(cwd: string, opts: { dryRun?: boolean } = {}): SkillResult[] {
  return SKILLS.map(({ name, body }) => {
    const path = join(cwd, ".claude", "skills", name, "SKILL.md");
    const desired = body.endsWith("\n") ? body : body + "\n";

    if (!existsSync(path)) {
      if (!opts.dryRun) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, desired, "utf-8");
      }
      return { name, path, action: "created" };
    }

    const current = readFileSync(path, "utf-8");
    if (current === desired) return { name, path, action: "noop" };
    if (!opts.dryRun) writeFileSync(path, desired, "utf-8");
    return { name, path, action: "updated" };
  });
}
