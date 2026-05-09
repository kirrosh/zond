import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import zondSkill from "./templates/skills/zond.md" with { type: "text" };
import scenariosSkill from "./templates/skills/scenarios.md" with { type: "text" };
import checksSkill from "./templates/skills/zond-checks.md" with { type: "text" };

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
  { name: "zond", body: zondSkill },
  { name: "zond-scenarios", body: scenariosSkill },
  // ARV-12 (m-15): depth-checks skill ships with a per-check
  // recommended_action triage table so agents route on the closed
  // enum instead of parsing finding messages.
  { name: "zond-checks", body: checksSkill },
];

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
