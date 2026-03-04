import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ciInitCommand } from "../../src/cli/commands/ci-init.ts";

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

describe("apitool ci init", () => {
  let tmpDir: string;
  let origCwd: string;
  let restoreOutput: () => void;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "apitool-ci-init-"));
    origCwd = process.cwd();
    process.chdir(tmpDir);
    restoreOutput = suppressOutput();
  });

  afterEach(() => {
    process.chdir(origCwd);
    restoreOutput();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("--github creates GitHub Actions workflow", async () => {
    const code = await ciInitCommand({ platform: "github", force: false });
    expect(code).toBe(0);

    const filePath = join(tmpDir, ".github/workflows/api-tests.yml");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("actions/checkout@v4");
    expect(content).toContain("apitool run");
    expect(content).toContain("--report junit");
    expect(content).toContain("install.sh");
  });

  test("--gitlab creates GitLab CI config", async () => {
    const code = await ciInitCommand({ platform: "gitlab", force: false });
    expect(code).toBe(0);

    const filePath = join(tmpDir, ".gitlab-ci.yml");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("api-smoke:");
    expect(content).toContain("apitool run");
    expect(content).toContain("junit: test-results/smoke.xml");
  });

  test("auto-detects GitHub when .github/ exists", async () => {
    mkdirSync(join(tmpDir, ".github"));

    const code = await ciInitCommand({ force: false });
    expect(code).toBe(0);

    expect(existsSync(join(tmpDir, ".github/workflows/api-tests.yml"))).toBe(true);
  });

  test("auto-detects GitLab when .gitlab-ci.yml exists", async () => {
    writeFileSync(join(tmpDir, ".gitlab-ci.yml"), "# existing\n");

    const code = await ciInitCommand({ platform: "gitlab", force: true });
    expect(code).toBe(0);

    const content = readFileSync(join(tmpDir, ".gitlab-ci.yml"), "utf-8");
    expect(content).toContain("api-smoke:");
  });

  test("defaults to GitHub when no platform detected", async () => {
    const code = await ciInitCommand({ force: false });
    expect(code).toBe(0);

    expect(existsSync(join(tmpDir, ".github/workflows/api-tests.yml"))).toBe(true);
  });

  test("skips existing file without --force", async () => {
    const dir = join(tmpDir, ".github/workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "api-tests.yml"), "original: true\n");

    const code = await ciInitCommand({ platform: "github", force: false });
    expect(code).toBe(0);

    const content = readFileSync(join(dir, "api-tests.yml"), "utf-8");
    expect(content).toBe("original: true\n");
  });

  test("--force overwrites existing file", async () => {
    const dir = join(tmpDir, ".github/workflows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "api-tests.yml"), "original: true\n");

    const code = await ciInitCommand({ platform: "github", force: true });
    expect(code).toBe(0);

    const content = readFileSync(join(dir, "api-tests.yml"), "utf-8");
    expect(content).toContain("actions/checkout@v4");
  });
});
