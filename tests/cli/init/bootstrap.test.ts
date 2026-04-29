import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootstrapWorkspace } from "../../../src/cli/commands/init/bootstrap.ts";

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
      "zond-scenarios",
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
});
