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

  test("integration=skip: only zond.config.yml + apis/, no AGENTS.md, no MCP install", () => {
    const r = bootstrapWorkspace({ cwd, home, integration: "skip" });
    expect(r.configAction).toBe("created");
    expect(r.apisAction).toBe("created");
    expect(r.agents).toBeNull();
    expect(r.mcpInstalled).toEqual([]);
    expect(existsSync(join(cwd, "zond.config.yml"))).toBe(true);
    expect(existsSync(join(cwd, "apis"))).toBe(true);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(home, ".claude", "mcp.json"))).toBe(false);
  });

  test("integration=mcp: writes AGENTS.md AND configures Claude + Cursor MCP", () => {
    const r = bootstrapWorkspace({ cwd, home, integration: "mcp" });
    expect(r.agents).not.toBeNull();
    expect(r.agents?.action).toBe("created");
    expect(r.mcpInstalled).toHaveLength(2);
    expect(r.mcpInstalled.map((m) => m.client).sort()).toEqual(["claude", "cursor"]);
    expect(r.mcpInstalled.every((m) => m.action === "created")).toBe(true);

    const agents = readFileSync(join(cwd, "AGENTS.md"), "utf-8");
    expect(agents).toContain("zond://workflow/test-api");

    const claudeCfg = JSON.parse(readFileSync(join(home, ".claude", "mcp.json"), "utf-8"));
    expect(claudeCfg.mcpServers.zond).toBeDefined();
    const cursorCfg = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf-8"));
    expect(cursorCfg.mcpServers.zond).toBeDefined();
  });

  test("integration=cli: AGENTS.md without zond:// URIs, no MCP install", () => {
    const r = bootstrapWorkspace({ cwd, home, integration: "cli" });
    expect(r.agents?.action).toBe("created");
    expect(r.mcpInstalled).toEqual([]);
    const agents = readFileSync(join(cwd, "AGENTS.md"), "utf-8");
    expect(agents).toContain("Mandatory rules");
    expect(agents).not.toContain("zond://workflow/test-api");
  });

  test("repeated bootstrap is idempotent", () => {
    bootstrapWorkspace({ cwd, home, integration: "mcp" });
    const r = bootstrapWorkspace({ cwd, home, integration: "mcp" });
    expect(r.configAction).toBe("noop");
    expect(r.apisAction).toBe("noop");
    expect(r.agents?.action).toBe("noop");
    expect(r.mcpInstalled.every((m) => m.action === "noop")).toBe(true);
  });

  test("dryRun does not write files", () => {
    const r = bootstrapWorkspace({ cwd, home, integration: "mcp", dryRun: true });
    expect(r.configAction).toBe("created");        // would-be action reported
    expect(existsSync(join(cwd, "zond.config.yml"))).toBe(false);
    expect(existsSync(join(cwd, "apis"))).toBe(false);
    expect(existsSync(join(home, ".claude", "mcp.json"))).toBe(false);
  });
});
