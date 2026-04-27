import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { installCommand } from "../../src/cli/commands/install.ts";
import { CLIENTS, installToClient } from "../../src/core/install/index.ts";

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = mock(() => true) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  return () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("installToClient (core)", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "zond-install-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test("creates a fresh ~/.claude/mcp.json with the zond entry", () => {
    const claude = CLIENTS.find((c) => c.id === "claude")!;
    const res = installToClient(claude, { home });
    expect(res.action).toBe("created");
    expect(res.configPath).toBe(join(home, ".claude", "mcp.json"));

    const cfg = readJson(res.configPath);
    expect(cfg).toEqual({
      mcpServers: {
        zond: { command: "zond", args: ["mcp", "start"] },
      },
    });
  });

  test("is idempotent: second invocation reports noop and does not change the file", () => {
    const claude = CLIENTS.find((c) => c.id === "claude")!;
    installToClient(claude, { home });
    const before = readFileSync(claude.configPath(home), "utf-8");

    const res = installToClient(claude, { home });
    expect(res.action).toBe("noop");
    expect(readFileSync(claude.configPath(home), "utf-8")).toBe(before);
  });

  test("merges into an existing config without losing other servers", () => {
    const claude = CLIENTS.find((c) => c.id === "claude")!;
    const path = claude.configPath(home);
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          theme: "dark",
          mcpServers: {
            backlog: { command: "bunx", args: ["backlog", "mcp", "start"] },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const res = installToClient(claude, { home });
    expect(res.action).toBe("updated");

    const cfg = readJson(path) as { theme: string; mcpServers: Record<string, unknown> };
    expect(cfg.theme).toBe("dark");
    expect(cfg.mcpServers.backlog).toEqual({ command: "bunx", args: ["backlog", "mcp", "start"] });
    expect(cfg.mcpServers.zond).toEqual({ command: "zond", args: ["mcp", "start"] });
  });

  test("dry-run does not create the file", () => {
    const claude = CLIENTS.find((c) => c.id === "claude")!;
    const res = installToClient(claude, { home, dryRun: true });
    expect(res.action).toBe("created");
    expect(existsSync(res.configPath)).toBe(false);
  });

  test("throws on existing non-JSON content rather than clobbering", () => {
    const claude = CLIENTS.find((c) => c.id === "claude")!;
    const path = claude.configPath(home);
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(path, "{this is not json", "utf-8");

    expect(() => installToClient(claude, { home })).toThrow(/not valid JSON/);
  });

  test("cursor spec writes to ~/.cursor/mcp.json", () => {
    const cursor = CLIENTS.find((c) => c.id === "cursor")!;
    const res = installToClient(cursor, { home });
    expect(res.configPath).toBe(join(home, ".cursor", "mcp.json"));
    const cfg = readJson(res.configPath) as { mcpServers: Record<string, unknown> };
    expect(cfg.mcpServers.zond).toEqual({ command: "zond", args: ["mcp", "start"] });
  });
});

describe("installCommand (CLI)", () => {
  let home: string;
  let restore: () => void;
  let originalHome: string | undefined;
  let originalUserprofile: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "zond-install-cli-"));
    originalHome = process.env.HOME;
    originalUserprofile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    restore = suppressOutput();
  });
  afterEach(() => {
    restore();
    if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
    if (originalUserprofile !== undefined) process.env.USERPROFILE = originalUserprofile;
    else delete process.env.USERPROFILE;
    rmSync(home, { recursive: true, force: true });
  });

  test("AC#1: --claude creates ~/.claude/mcp.json with zond server", async () => {
    const code = await installCommand({ claude: true, sanity: false });
    expect(code).toBe(0);
    const cfg = readJson(join(home, ".claude", "mcp.json")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cfg.mcpServers.zond).toEqual({ command: "zond", args: ["mcp", "start"] });
  });

  test("--all writes both Claude and Cursor configs", async () => {
    const code = await installCommand({ all: true, sanity: false });
    expect(code).toBe(0);
    expect(existsSync(join(home, ".claude", "mcp.json"))).toBe(true);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(true);
  });

  test("no flags returns exit 1 with hint", async () => {
    const code = await installCommand({ sanity: false });
    expect(code).toBe(1);
  });

  test("--dry-run does not write any file", async () => {
    const code = await installCommand({ all: true, dryRun: true, sanity: false });
    expect(code).toBe(0);
    expect(existsSync(join(home, ".claude", "mcp.json"))).toBe(false);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
  });

  test("AC#2: sanity-check connects an in-process client and reports tools/resources/templates", async () => {
    let captured = "";
    restore();
    const origOut = process.stdout.write;
    process.stdout.write = mock((data: any) => {
      captured += String(data);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = mock(() => true) as typeof process.stderr.write;
    restore = () => {
      process.stdout.write = origOut;
    };

    const code = await installCommand({ claude: true, json: true });
    expect(code).toBe(0);

    const envelope = JSON.parse(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("install");
    const sanity = envelope.data.sanity as {
      ok: boolean;
      toolCount: number;
      resourceCount: number;
      templateCount: number;
    };
    expect(sanity.ok).toBe(true);
    expect(sanity.toolCount).toBeGreaterThan(0);
    expect(sanity.resourceCount).toBe(8);
    expect(sanity.templateCount).toBe(2);
  });
});
