import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootstrapWorkspace } from "../../../src/cli/commands/init/bootstrap.ts";
import { detectSkillDrift } from "../../../src/cli/commands/init/skills.ts";

describe("bootstrapWorkspace", () => {
  let cwd: string;
  let home: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "zond-boot-cwd-"));
    home = mkdtempSync(join(tmpdir(), "zond-boot-home-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test("integration=skip: only zond.config.yml + apis/, no AGENTS.md, no skills", () => {
    const r = bootstrapWorkspace({ cwd, home, writeAgents: false, writeSkills: false });
    expect(r.configAction).toBe("created");
    expect(r.apisAction).toBe("created");
    expect(r.agents).toBeNull();
    expect(r.skills).toEqual([]);
    expect(existsSync(join(cwd, "zond.config.yml"))).toBe(true);
    expect(existsSync(join(cwd, "apis"))).toBe(true);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  test("writes Claude Code skills under .claude/skills/", () => {
    const r = bootstrapWorkspace({ cwd, home, writeAgents: false });
    expect(r.skills.map((s) => s.name).sort()).toEqual([
      "zond",
      "zond-checks",
      "zond-seed",
      "zond-triage",
    ]);
    expect(r.skills.every((s) => s.action === "created")).toBe(true);
    for (const s of r.skills) {
      expect(existsSync(s.path)).toBe(true);
      const body = readFileSync(s.path, "utf-8");
      expect(body).toContain(`name: ${s.name}`);
    }
  });

  test("integration=cli: AGENTS.md created", () => {
    const r = bootstrapWorkspace({ cwd, home });
    expect(r.agents?.action).toBe("created");
    const agents = readFileSync(join(cwd, "AGENTS.md"), "utf-8");
    expect(agents).toContain("Mandatory rules");
  });

  test("repeated bootstrap is idempotent", () => {
    bootstrapWorkspace({ cwd, home });
    const r = bootstrapWorkspace({ cwd, home });
    expect(r.configAction).toBe("noop");
    expect(r.apisAction).toBe("noop");
    expect(r.agents?.action).toBe("noop");
    expect(r.skills.every((s) => s.action === "noop")).toBe(true);
  });

  test("dryRun does not write files", () => {
    const r = bootstrapWorkspace({ cwd, home, dryRun: true });
    expect(r.configAction).toBe("created");
    expect(existsSync(join(cwd, "zond.config.yml"))).toBe(false);
    expect(existsSync(join(cwd, "apis"))).toBe(false);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  test("stale legacy skill dirs are detected and warned-about by default", () => {
    // seed legacy skill from a prior init
    mkdirSync(join(cwd, ".claude", "skills", "zond-base"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "skills", "zond-base", "SKILL.md"), "---\nname: zond-base\n---\n");

    const r = bootstrapWorkspace({ cwd, home });
    expect(r.staleSkills.map((s) => s.name)).toEqual(["zond-base"]);
    expect(r.prunedSkills).toEqual([]);
    expect(r.warnings).toContain(
      "stale skill detected: .claude/skills/zond-base/ — re-run with --prune-stale-skills to remove",
    );
    // Warn-only: dir is still on disk.
    expect(existsSync(join(cwd, ".claude", "skills", "zond-base"))).toBe(true);
  });

  test("--prune-stale-skills removes legacy skill dirs", () => {
    mkdirSync(join(cwd, ".claude", "skills", "zond-base"), { recursive: true });
    mkdirSync(join(cwd, ".claude", "skills", "zond-scenarios"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "skills", "zond-base", "SKILL.md"), "x");
    writeFileSync(join(cwd, ".claude", "skills", "zond-scenarios", "SKILL.md"), "y");

    const r = bootstrapWorkspace({ cwd, home, pruneStaleSkills: true });
    expect(r.prunedSkills.map((s) => s.name).sort()).toEqual(["zond-base", "zond-scenarios"]);
    expect(r.warnings).not.toContain(expect.stringContaining("stale skill detected"));
    expect(existsSync(join(cwd, ".claude", "skills", "zond-base"))).toBe(false);
    expect(existsSync(join(cwd, ".claude", "skills", "zond-scenarios"))).toBe(false);
  });

  test("ARV-237: detectSkillDrift reports missing/outdated/fresh per template", () => {
    // Fresh workspace, no skills written yet — every template is missing.
    let drift = detectSkillDrift(cwd);
    expect(drift.every(d => d.status === "missing")).toBe(true);

    // After bootstrap — all fresh.
    bootstrapWorkspace({ cwd, home, writeAgents: false });
    drift = detectSkillDrift(cwd);
    expect(drift.every(d => d.status === "fresh")).toBe(true);

    // Corrupt one — flips to outdated.
    writeFileSync(join(cwd, ".claude", "skills", "zond", "SKILL.md"), "stale\n");
    drift = detectSkillDrift(cwd);
    const zondEntry = drift.find(d => d.name === "zond")!;
    expect(zondEntry.status).toBe("outdated");
    // Other skills unaffected.
    expect(drift.find(d => d.name === "zond-checks")!.status).toBe("fresh");
  });

  test("user-authored skill dirs are NOT pruned even with --prune-stale-skills", () => {
    // user skill — not in LEGACY_SKILL_NAMES
    mkdirSync(join(cwd, ".claude", "skills", "zond-max-coverage"), { recursive: true });
    writeFileSync(join(cwd, ".claude", "skills", "zond-max-coverage", "SKILL.md"), "user-content");

    const r = bootstrapWorkspace({ cwd, home, pruneStaleSkills: true });
    expect(r.staleSkills).toEqual([]);
    expect(r.prunedSkills).toEqual([]);
    expect(existsSync(join(cwd, ".claude", "skills", "zond-max-coverage"))).toBe(true);
    expect(readFileSync(join(cwd, ".claude", "skills", "zond-max-coverage", "SKILL.md"), "utf-8"))
      .toBe("user-content");
  });
});
