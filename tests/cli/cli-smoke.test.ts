import { describe, test, expect } from "bun:test";
import { join } from "path";
import { VERSION } from "../../src/cli/version.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

async function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("CLI smoke (real process)", () => {
  test("--help prints usage with command list, exit 0", async () => {
    const { exitCode, stdout } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: zond");
    // Spot-check: at least 5 known commands present
    for (const cmd of ["run", "validate", "serve", "coverage", "init"]) {
      expect(stdout).toContain(cmd);
    }
    // 'ui' alias is removed
    expect(stdout).not.toMatch(/^\s*ui\b/m);
  });

  test("--version prints VERSION + runtime, exit 0", async () => {
    const { exitCode, stdout } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(VERSION);
  });

  test("unknown command exits 2 with helpful error", async () => {
    const { exitCode, stderr } = await runCli(["foobar"]);
    expect(exitCode).toBe(2);
    expect(stderr.toLowerCase()).toContain("unknown command");
  });

  test("'zond ui' (removed alias) exits 2 — see also program.test.ts", async () => {
    const { exitCode, stderr } = await runCli(["ui"]);
    expect(exitCode).toBe(2);
    expect(stderr.toLowerCase()).toContain("unknown command");
  });

  test("'mcp --help' lists 'start' subcommand, exit 0", async () => {
    const { exitCode, stdout } = await runCli(["mcp", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("start");
  });

  test("'mcp start --help' shows --db option, exit 0", async () => {
    const { exitCode, stdout } = await runCli(["mcp", "start", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--db");
  });
});
