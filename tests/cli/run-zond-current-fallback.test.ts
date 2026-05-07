import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { buildProgram } from "../../src/cli/program.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";
import { makeWorkspace } from "../_helpers/workspace";

describe("zond run — .zond-current fallback (TASK-68)", () => {
  let workRoot: string;
  let cleanupWs: () => void;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    const ws = makeWorkspace({ prefix: "zond-task68-", marker: "apis", chdir: true });
    workRoot = ws.path;
    cleanupWs = ws.cleanup;
    suppress = captureOutput();
  });

  afterEach(() => {
    suppress.restore();
    closeDb();
    process.exitCode = 0;
    cleanupWs();
  });

  test("no path + no .zond-current → clear error mentioning .zond-current (not 'got boolean')", async () => {
    const program = buildProgram();
    await program.parseAsync(["bun", "script.ts", "run", "--safe"]);

    const stderr = suppress.errChunks.join("");
    expect(stderr).not.toContain("got boolean");
    expect(stderr).not.toContain("paths[0]");
    expect(stderr).toContain(".zond-current");
    expect(process.exitCode).toBe(2);
  });

  test("no path + .zond-current set but unknown api → 'API ... not found' (not boolean crash)", async () => {
    writeFileSync(join(workRoot, ".zond-current"), "resend\n", "utf-8");

    const program = buildProgram();
    await program.parseAsync(["bun", "script.ts", "run", "--safe"]);

    const stderr = suppress.errChunks.join("");
    expect(stderr).not.toContain("got boolean");
    expect(stderr).not.toContain("paths[0]");
    // collection wasn't created → expect a recognizable resolver failure,
    // either "not found" or "no test_path", but never the boolean leak.
    expect(stderr.toLowerCase()).toMatch(/not found|test_path|api/);
  });
});
