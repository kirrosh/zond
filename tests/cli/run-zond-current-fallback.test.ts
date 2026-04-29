import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildProgram } from "../../src/cli/program.ts";
import { closeDb } from "../../src/db/schema.ts";

const originalCwd = process.cwd();

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const errChunks: string[] = [];
  const outChunks: string[] = [];
  process.stdout.write = mock((chunk: unknown) => {
    outChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
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
    outChunks,
  };
}

describe("zond run — .zond-current fallback (TASK-68)", () => {
  let workRoot: string;
  let suppress: ReturnType<typeof suppressOutput>;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), "zond-task68-"));
    // Workspace marker so findWorkspaceRoot anchors here.
    mkdirSync(join(workRoot, "apis"));
    process.chdir(workRoot);
    suppress = suppressOutput();
  });

  afterEach(() => {
    suppress.restore();
    closeDb();
    process.exitCode = 0;
    process.chdir(originalCwd);
    try { rmSync(workRoot, { recursive: true, force: true }); } catch { /* ignore */ }
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
