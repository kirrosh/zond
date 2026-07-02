/**
 * ARV-72 (feedback round-02 / F14): `zond run` was already returning
 * exit 1 when any step failed, but the tester reported "545 failed,
 * exit_code=0" and couldn't tell whether the shell or a wrapper had
 * eaten the non-zero code. This test pins:
 *   1) the default exit code is 1 on failure,
 *   2) --no-fail-on-failures forces exit 0 (advisory runs),
 *   3) the stderr tail names the count so wrappers that hide exit codes
 *      remain auditable from the log.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram, preprocessArgv } from "../../src/cli/program.ts";
import { closeDb } from "../../src/db/schema.ts";
import { captureOutput } from "../_helpers/output";

describe("zond run: --fail-on-failures default + override (ARV-72)", () => {
  let workspace: string;
  let savedCwd: string;
  let exitSpy: typeof process.exit;
  let lastExit: number | undefined;
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-run-foF-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n");
    savedCwd = process.cwd();
    process.chdir(workspace);

    mkdirSync(join(workspace, "tests"), { recursive: true });
    server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("nope", { status: 500 });
      },
    });
    const baseUrl = `http://localhost:${server.port}`;
    writeFileSync(
      join(workspace, "tests", "smoke.yaml"),
      `name: smoke\nbase_url: ${baseUrl}\ntests:\n  - name: hit\n    GET: /ping\n    expect:\n      status: 200\n`,
    );

    exitSpy = process.exit;
    lastExit = undefined;
    process.exit = ((code?: number) => {
      lastExit = typeof code === "number" ? code : 0;
      throw new Error(`__exit_${lastExit}__`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = exitSpy;
    server.stop(true);
    closeDb();
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  async function runCli(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
    const cap = captureOutput();
    const program = buildProgram();
    try {
      await program.parseAsync(preprocessArgv(["bun", "zond", ...argv]));
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith("__exit_")) {
        cap.restore();
        throw err;
      }
    }
    const { out, err } = cap;
    cap.restore();
    const ec = lastExit !== undefined ? lastExit : (process.exitCode === undefined ? 0 : Number(process.exitCode));
    process.exitCode = 0;
    return { stdout: out, stderr: err, exitCode: ec };
  }

  test("default: failing step → exit 1 and stderr tail names the count", async () => {
    const { stderr, exitCode } = await runCli(["run", "tests/smoke.yaml"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("step(s) failed");
    expect(stderr).toContain("exiting with code 1");
  });

  test("--no-fail-on-failures: same failure → exit 0, stderr tail still surfaces the count", async () => {
    const { stderr, exitCode } = await runCli(["run", "tests/smoke.yaml", "--no-fail-on-failures"]);
    expect(exitCode).toBe(0);
    expect(stderr).toContain("step(s) failed");
  });
});
