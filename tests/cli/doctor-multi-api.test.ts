/**
 * ARV-96: `zond doctor --api <name>` must work on a multi-API workspace.
 *
 * Pre-fix, the doctor action handler only inspected `opts.api` (the
 * subcommand-local Commander scope). On a workspace with >1 API, the
 * program-level `--api` option (program.ts) absorbs the flag for the
 * `zond --api X doctor` form, and Commander's parser leaves the
 * subcommand-attached `zond doctor --api X` form on the program scope as
 * well — so doctor never saw the value and fell through to the
 * "Multiple APIs registered" branch. Other commands (check spec /
 * prepare-fixtures / checks / probe) routed through `getApi(cmd, opts)`
 * which walks the global chain; doctor was the lone hold-out.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupApi } from "../../src/core/setup-api.ts";
import { closeDb } from "../../src/db/schema.ts";
import { buildProgram, preprocessArgv } from "../../src/cli/program.ts";
import { captureOutput } from "../_helpers/output";

const SPEC = (title: string) => JSON.stringify({
  openapi: "3.0.0",
  info: { title, version: "1.0" },
  servers: [{ url: `https://${title}.example.com` }],
  paths: { "/ping": { get: { responses: { "200": {} } } } },
});

describe("doctor --api on multi-API workspace (ARV-96)", () => {
  let workspace: string;
  let savedCwd: string;
  let dbPath: string;
  let exitSpy: typeof process.exit;
  let lastExit: number | undefined;

  beforeEach(async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-doctor-multi-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n");
    const fooSpec = join(workspace, "foo-spec.json");
    const barSpec = join(workspace, "bar-spec.json");
    writeFileSync(fooSpec, SPEC("foo"));
    writeFileSync(barSpec, SPEC("bar"));
    dbPath = join(workspace, "zond.db");
    savedCwd = process.cwd();
    process.chdir(workspace);
    await setupApi({ name: "foo", spec: fooSpec, dbPath });
    await setupApi({ name: "bar", spec: barSpec, dbPath });
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
    delete process.env.ZOND_API_GLOBAL;
    delete process.env.ZOND_API;
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
    return { stdout: out, stderr: err, exitCode: lastExit ?? (process.exitCode as number | undefined) };
  }

  test("subcommand-attached: `zond doctor --api foo`", async () => {
    const { stderr, stdout } = await runCli(["doctor", "--api", "foo", "--db", dbPath]);
    expect(stderr + stdout).not.toContain("Multiple APIs registered");
  });

  test("subcommand-attached --json: `zond doctor --api=foo --json`", async () => {
    const { stderr, stdout } = await runCli(["doctor", "--api=foo", "--json", "--db", dbPath]);
    expect(stderr + stdout).not.toContain("Multiple APIs registered");
    expect(stdout).toMatch(/"api":\s*"foo"/);
  });

  test("program-attached: `zond --api foo doctor`", async () => {
    const { stderr, stdout } = await runCli(["--api", "foo", "doctor", "--db", dbPath]);
    expect(stderr + stdout).not.toContain("Multiple APIs registered");
  });

  test("ZOND_API env still resolves on multi-API workspace", async () => {
    process.env.ZOND_API = "bar";
    const { stderr, stdout } = await runCli(["doctor", "--db", dbPath, "--json"]);
    expect(stderr + stdout).not.toContain("Multiple APIs registered");
    expect(stdout).toMatch(/"api":\s*"bar"/);
  });

  test("no signal at all: still emits the original 'Multiple APIs' error", async () => {
    const { stderr, stdout } = await runCli(["doctor", "--db", dbPath]);
    expect(stderr + stdout).toContain("Multiple APIs registered");
  });
});
