import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const errChunks: string[] = [];
  process.stdout.write = mock(() => true) as typeof process.stdout.write;
  process.stderr.write = mock((chunk: unknown) => {
    errChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    restore: () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
    errChunks,
  };
}

describe("TASK-72: tag filter does not silently swallow parse errors", () => {
  let workDir: string;
  let suppress: ReturnType<typeof suppressOutput>;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "zond-task72-"));
    suppress = suppressOutput();
  });

  afterEach(() => {
    suppress.restore();
    rmSync(workDir, { recursive: true, force: true });
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
      path: workDir,
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
      path: workDir,
      report: "console",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(2);
    const stderr = suppress.errChunks.join("");
    expect(stderr).toMatch(/All 2 test file\(s\).*failed to parse/);
  });
});
