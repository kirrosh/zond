import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { ciInitCommand } from "../../src/cli/commands/ci-init.ts";
import { captureOutput } from "../_helpers/output";
import { makeWorkspace } from "../_helpers/workspace";

describe("zond ci init", () => {
  let tmpDir: string;
  let cleanupWs: () => void;
  let restoreOutput: () => void;

  beforeEach(() => {
    const ws = makeWorkspace({ prefix: "zond-ci-init-", chdir: true });
    tmpDir = ws.path;
    cleanupWs = ws.cleanup;
    restoreOutput = captureOutput().restore;
  });

  afterEach(() => {
    restoreOutput();
    cleanupWs();
  });

  test("--github creates GitHub Actions workflow", async () => {
    const code = await ciInitCommand({ platform: "github", force: false });
    expect(code).toBe(0);

    const filePath = join(tmpDir, ".github/workflows/api-tests.yml");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("actions/checkout@v4");
    expect(content).toContain("zond run");
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
    expect(content).toContain("zond run");
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
