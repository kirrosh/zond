import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initCommand } from "../../src/cli/commands/init.ts";

// Suppress stdout/stderr during tests
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

describe("apitool init", () => {
  let tmpDir: string;
  let origCwd: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "apitool-init-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    restoreOutput = suppressOutput();
  });

  afterEach(() => {
    process.chdir(origCwd);
    restoreOutput();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates example test and env files", async () => {
    const code = await initCommand({ force: false });
    expect(code).toBe(0);

    expect(existsSync(join(tmpDir, "tests/example.yaml"))).toBe(true);
    expect(existsSync(join(tmpDir, ".env.dev.yaml"))).toBe(true);

    const testContent = readFileSync(join(tmpDir, "tests/example.yaml"), "utf-8");
    expect(testContent).toContain("Example Smoke Test");
    expect(testContent).toContain("base_url");

    const envContent = readFileSync(join(tmpDir, ".env.dev.yaml"), "utf-8");
    expect(envContent).toContain("jsonplaceholder");
  });

  test("skips existing files without --force", async () => {
    writeFileSync(join(tmpDir, ".env.dev.yaml"), "original: true\n");

    const code = await initCommand({ force: false });
    expect(code).toBe(0);

    // tests/example.yaml should be created
    expect(existsSync(join(tmpDir, "tests/example.yaml"))).toBe(true);

    // .env.dev.yaml should NOT be overwritten
    const envContent = readFileSync(join(tmpDir, ".env.dev.yaml"), "utf-8");
    expect(envContent).toBe("original: true\n");
  });

  test("--force overwrites existing files", async () => {
    writeFileSync(join(tmpDir, ".env.dev.yaml"), "original: true\n");

    const code = await initCommand({ force: true });
    expect(code).toBe(0);

    const envContent = readFileSync(join(tmpDir, ".env.dev.yaml"), "utf-8");
    expect(envContent).toContain("jsonplaceholder");
  });

  test("returns 0 exit code", async () => {
    const code = await initCommand({ force: false });
    expect(code).toBe(0);
  });
});
