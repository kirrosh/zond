/**
 * ARV-63 (feedback round-01 / F2): tester (and earlier docs / skill
 * prompts) referenced `--report ndjson`, but the implementation only
 * accepted `sarif` there and bailed with "Unknown --report format". The
 * NDJSON streaming channel lived behind the separate `--ndjson` flag,
 * and `--report ndjson` was wired in as an alias for it.
 *
 * ARV-118 (m-19) promoted `--report ndjson` to a first-class format on
 * the typed OutputSpec and removed `--ndjson`. This test now pins both
 * the streaming behaviour and the help-error message listing ndjson
 * next to sarif.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupApi } from "../../../src/core/setup-api.ts";
import { closeDb } from "../../../src/db/schema.ts";
import { buildProgram, preprocessArgv } from "../../../src/cli/program.ts";
import { captureOutput } from "../../_helpers/output";

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "tiny", version: "1.0" },
  servers: [{ url: "http://127.0.0.1:1/" }], // unused — checks fall through 'network_error', that's fine
  paths: { "/ping": { get: { responses: { "200": {} } } } },
});

describe("checks run: --report ndjson is an alias for --ndjson (ARV-63)", () => {
  let workspace: string;
  let savedCwd: string;
  let dbPath: string;
  let exitSpy: typeof process.exit;
  let lastExit: number | undefined;

  beforeEach(async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-checks-ndjson-alias-")));
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

  test("--report ndjson streams NDJSON events on stdout (same as --ndjson)", async () => {
    const { stdout, stderr } = await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--report", "ndjson", "--db", dbPath,
    ]);
    expect(stderr).not.toContain("Unknown --report format");
    // First non-empty line should parse as a JSON event with a recognised type.
    const firstLine = stdout.split("\n").find((l) => l.trim().length > 0) ?? "";
    expect(firstLine.startsWith("{")).toBe(true);
    const parsed = JSON.parse(firstLine);
    expect(typeof parsed.type).toBe("string");
    expect(["check_start", "check_result", "finding", "summary"]).toContain(parsed.type);
  });

  test("--report some-garbage still errors, and the message lists ndjson next to sarif", async () => {
    const { stderr } = await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--report", "junit", "--db", dbPath,
    ]);
    expect(stderr).toContain('Unknown --report format: "junit"');
    expect(stderr).toContain("ndjson");
    expect(stderr).toContain("sarif");
  });
});
