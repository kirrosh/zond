/**
 * ARV-97 (feedback round-01 / F2): `zond checks run --report ndjson
 * --output <path>` was silently dropping the file. The alias rewrite
 * (`--report ndjson` → `opts.ndjson = true; opts.report = undefined`)
 * routed the run through the streaming branch, which only writes to
 * stdout — `opts.output` was never inspected. Tester saw a stale .ndjson
 * from a previous session and analysed it as if it were the current
 * Sentry output.
 *
 * The fix opens an fd up front when `ndjson && opts.output` and pipes
 * events into the file instead of stdout. Re-running with the same path
 * truncates (matches the SARIF branch). This file pins both behaviours
 * and the human "written to" line on stderr.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupApi } from "../../../src/core/setup-api.ts";
import { closeDb } from "../../../src/db/schema.ts";
import { buildProgram, preprocessArgv } from "../../../src/cli/program.ts";
import { captureOutput } from "../../_helpers/output";

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "tiny", version: "1.0" },
  servers: [{ url: "http://127.0.0.1:1/" }],
  paths: { "/ping": { get: { responses: { "200": {} } } } },
});

describe("checks run: --report ndjson --output writes to file (ARV-97)", () => {
  let workspace: string;
  let savedCwd: string;
  let dbPath: string;
  let exitSpy: typeof process.exit;
  let lastExit: number | undefined;

  beforeEach(async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-checks-ndjson-output-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n");
    const specPath = join(workspace, "spec.json");
    writeFileSync(specPath, SPEC);
    dbPath = join(workspace, "zond.db");
    savedCwd = process.cwd();
    process.chdir(workspace);
    await setupApi({ name: "foo", spec: specPath, dbPath });
    closeDb();

    exitSpy = process.exit;
    lastExit = undefined;
    process.exit = ((code?: number) => {
      lastExit = typeof code === "number" ? code : 0;
      throw new Error(`__exit_${lastExit}__`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = exitSpy;
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
    return { stdout: out, stderr: err, exitCode: lastExit };
  }

  test("--report ndjson --output <path> creates the file with one JSON event per line", async () => {
    const outPath = join(workspace, "out.ndjson");
    const { stdout, stderr } = await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--report", "ndjson", "--output", outPath, "--db", dbPath,
    ]);

    expect(existsSync(outPath)).toBe(true);
    // Stream redirected to file; stdout must NOT carry NDJSON events anymore.
    expect(stdout.trim()).toBe("");
    // Human summary still on stderr + the "written to" hint.
    expect(stderr).toContain("written to");
    expect(stderr).toContain(outPath);

    const lines = readFileSync(outPath, "utf-8").split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const ev = JSON.parse(line) as { type?: string };
      expect(typeof ev.type).toBe("string");
      expect(["check_start", "check_result", "finding", "summary"]).toContain(ev.type!);
    }
  });

  test("--ndjson --output <path> (no alias) honours --output too", async () => {
    const outPath = join(workspace, "alt.ndjson");
    await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--ndjson", "--output", outPath, "--db", dbPath,
    ]);

    expect(existsSync(outPath)).toBe(true);
    const text = readFileSync(outPath, "utf-8");
    expect(text.length).toBeGreaterThan(0);
  });

  test("re-running with the same --output truncates instead of appending", async () => {
    const outPath = join(workspace, "rewrite.ndjson");
    // Plant a stale file the run must overwrite (mirrors the SARIF branch
    // contract: `writeFileSync` overwrites).
    writeFileSync(outPath, "{\"type\":\"stale\"}\n", "utf-8");

    await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--report", "ndjson", "--output", outPath, "--db", dbPath,
    ]);

    const text = readFileSync(outPath, "utf-8");
    expect(text).not.toContain("\"stale\"");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const ev = JSON.parse(line) as { type?: string };
      expect(["check_start", "check_result", "finding", "summary"]).toContain(ev.type!);
    }
  });

  test("--report ndjson without --output keeps the legacy stdout-streaming behaviour", async () => {
    const { stdout } = await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--report", "ndjson", "--db", dbPath,
    ]);
    const firstLine = stdout.split("\n").find((l) => l.trim().length > 0) ?? "";
    expect(firstLine.startsWith("{")).toBe(true);
    const ev = JSON.parse(firstLine) as { type?: string };
    expect(typeof ev.type).toBe("string");
  });
});
