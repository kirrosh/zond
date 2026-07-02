/**
 * ARV-320: `checks run --report ndjson` exited 1 on a HIGH/CRITICAL finding
 * with ZERO explanation on stderr — the human-readable "N HIGH/CRITICAL
 * finding(s) — exiting with code 1" tail was gated on `!ndjson`, under the
 * (false, for the ndjson branch) assumption that "stderr already carried
 * the summary just above". In ndjson mode the only stderr line was
 * "NDJSON report written to <path>", so under `set -e` in CI the step
 * "failed" with no visible reason (report-zond friction, 2026-07-02 Stripe
 * run — a genuine HIGH was present, so exit 1 was correct, but silent).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupApi } from "../../../src/core/setup-api.ts";
import { closeDb } from "../../../src/db/schema.ts";
import { buildProgram, preprocessArgv } from "../../../src/cli/program.ts";
import { captureOutput } from "../../_helpers/output";

describe("checks run --report ndjson: HIGH finding exit is explained on stderr (ARV-320)", () => {
  let workspace: string;
  let savedCwd: string;
  let dbPath: string;
  let exitSpy: typeof process.exit;
  let lastExit: number | undefined;
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(async () => {
    server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 500 }) });
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "tiny", version: "1.0" },
      servers: [{ url: `http://127.0.0.1:${server.port}/` }],
      paths: { "/ping": { get: { responses: { "200": {} } } } },
    });

    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-ndjson-high-exit-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n");
    const specPath = join(workspace, "spec.json");
    writeFileSync(specPath, spec);
    dbPath = join(workspace, "zond.db");
    savedCwd = process.cwd();
    process.chdir(workspace);
    await setupApi({ name: "foo", spec: specPath, dbPath });
    closeDb();

    exitSpy = process.exit;
    lastExit = undefined;
    // First exit wins: the mocked throwing stub is caught by checksRunAction's
    // own try/catch (which then re-calls process.exit(2) on ANY caught error,
    // including our thrown stand-in) — recording only the first call models
    // the real (single, terminating) process.exit faithfully. Matches the
    // established pattern in no-fail-on-findings.test.ts (ARV-308).
    process.exit = ((code?: number) => {
      if (lastExit === undefined) lastExit = typeof code === "number" ? code : 0;
      throw new Error(`__exit__`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = exitSpy;
    closeDb();
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
    server.stop(true);
  });

  async function runCli(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
    const cap = captureOutput();
    const program = buildProgram();
    try {
      await program.parseAsync(preprocessArgv(["bun", "zond", ...argv]));
    } catch (err) {
      if (!(err instanceof Error) || err.message !== "__exit__") {
        cap.restore();
        throw err;
      }
    }
    const { out, err } = cap;
    cap.restore();
    return { stdout: out, stderr: err, exitCode: lastExit };
  }

  test("exit 1 with a stderr line naming the HIGH count (not just 'written to')", async () => {
    const outPath = join(workspace, "out.ndjson");
    const { stderr, exitCode } = await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--report", "ndjson", "--output", outPath, "--db", dbPath,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("written to");
    expect(stderr).toMatch(/HIGH\/CRITICAL finding\(s\)/);
    expect(stderr).toContain("exiting with code 1");
  });

  test("--advisory: still explains the count but exits 0", async () => {
    const outPath = join(workspace, "out.ndjson");
    const { stderr, exitCode } = await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--report", "ndjson", "--output", outPath, "--db", dbPath, "--advisory",
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/HIGH\/CRITICAL finding\(s\)/);
    expect(stderr).toContain("advisory mode, exiting 0");
  });
});
