/**
 * ARV-37: `zond run --tag <unknown>` used to print a warning and exit 0,
 * which masked CI typos like `--tag smok` (vs `smoke`) as green builds.
 * Regression: zero-match selectors must exit non-zero, and `--tag` must
 * surface the tags actually available across loaded suites.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { writeFileSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";
import { makeWorkspace } from "../_helpers/workspace";

describe("ARV-37: zero-match selectors exit non-zero", () => {
  let workDir: string;
  let cleanupWs: () => void;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    const ws = makeWorkspace({ prefix: "zond-arv37-" });
    workDir = ws.path;
    cleanupWs = ws.cleanup;
    writeFileSync(
      join(workDir, "smoke.yaml"),
      "name: Smoke\ntags: [smoke, positive]\ntests:\n  - name: T\n    GET: /x\n    expect: {}\n",
    );
    writeFileSync(
      join(workDir, "crud.yaml"),
      "name: Crud\ntags: [crud]\ntests:\n  - name: T\n    GET: /y\n    expect: {}\n",
    );
    suppress = captureOutput();
  });

  afterEach(() => {
    suppress.restore();
    cleanupWs();
    closeDb();
  });

  test("--tag <typo> exits 1 with available-tags hint", async () => {
    const code = await runCommand({
      paths: [workDir],
      report: "console",
      bail: false,
      tag: ["smok"],
      noDb: true,
    });

    expect(code).toBe(1);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toContain("No suites match tags [smok]");
    expect(stderr).toContain("Available tags:");
    expect(stderr).toContain("smoke");
    expect(stderr).toContain("crud");
    expect(stderr).toContain("positive");
  });

  test("--method on suites with no matching method exits 1", async () => {
    const code = await runCommand({
      paths: [workDir],
      report: "console",
      bail: false,
      method: "delete",
      noDb: true,
    });

    expect(code).toBe(1);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toContain("No tests found with method DELETE");
  });

  test("--exclude-tag that drops every suite exits 1", async () => {
    const code = await runCommand({
      paths: [workDir],
      report: "console",
      bail: false,
      excludeTag: ["smoke", "crud"],
      noDb: true,
    });

    expect(code).toBe(1);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toContain("All suites excluded by --exclude-tag");
  });
});
