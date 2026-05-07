import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { writeFileSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";
import { makeWorkspace } from "../_helpers/workspace";

describe("TASK-72: tag filter does not silently swallow parse errors", () => {
  let workDir: string;
  let cleanupWs: () => void;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    const ws = makeWorkspace({ prefix: "zond-task72-" });
    workDir = ws.path;
    cleanupWs = ws.cleanup;
    suppress = captureOutput();
  });

  afterEach(() => {
    suppress.restore();
    cleanupWs();
    closeDb();
  });

  test("parse error in --tag filter run → warning + exit 1", async () => {
    // Only file with the requested tag has a parse error → must NOT say "no suites match"
    writeFileSync(
      join(workDir, "broken.yaml"),
      "name: Broken\ntags: [crlf]\ntests:\n  - this is: { not valid\n",
    );
    writeFileSync(
      join(workDir, "ok.yaml"),
      "name: OK\ntags: [other]\ntests:\n  - name: T\n    GET: /x\n    expect: {}\n",
    );

    const code = await runCommand({
      paths: [workDir],
      report: "console",
      bail: false,
      tag: ["crlf"],
      noDb: true,
    });

    expect(code).toBe(1);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toContain("Skipped");
    expect(stderr).toContain("broken.yaml");
    expect(stderr).toMatch(/failed to parse/i);
  });

  test("all files fail to parse → exit 2 with explicit message", async () => {
    writeFileSync(join(workDir, "a.yaml"), ":\n: invalid\n");
    writeFileSync(join(workDir, "b.yaml"), "{{{ not yaml\n");

    const code = await runCommand({
      paths: [workDir],
      report: "console",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(2);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toMatch(/All 2 test file\(s\).*failed to parse/);
  });
});
