/**
 * Regression for the ARV-17 bug: `zond checks run --api foo` was
 * losing the `--api` value because commander attached the flag to the
 * program-level `--api` option (defined for the global resolution chain
 * in program.ts) instead of the `checks run` subcommand. resolveBaseUrl
 * only inspected `opts.api` and `cmd.parent?.opts().api`, so the
 * program-level value never reached it and the user saw a confusing
 * "Need --base-url" error despite a perfectly good base_url in
 * apis/<name>/.env.yaml.
 *
 * The fix wires resolveBaseUrl (and the auth-header derivation) into
 * the same fallback chain as resolveSpecArg / `zond use`.
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
  servers: [{ url: "https://api.example.com" }],
  paths: { "/ping": { get: { responses: { "200": {} } } } },
});

describe("checks run --api resolves base_url through the global chain (ARV-17)", () => {
  let workspace: string;
  let savedCwd: string;
  let dbPath: string;
  let exitSpy: typeof process.exit;
  let lastExit: number | undefined;

  beforeEach(async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-checks-api-")));
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
      // process.exit() throws via our spy — swallow that branch.
      if (!(err instanceof Error) || !err.message.startsWith("__exit_")) {
        cap.restore();
        throw err;
      }
    }
    const { out, err } = cap;
    cap.restore();
    return { stdout: out, stderr: err, exitCode: lastExit };
  }

  test("subcommand-attached --api: `zond checks --api foo run`", async () => {
    // commander attaches --api to the `checks` group when written before
    // `run`, so opts.api on the leaf is undefined but cmd.parent.opts().api
    // is set. Pre-fix this path already worked.
    const { stderr } = await runCli(["checks", "--api", "foo", "run", "--check", "not_a_server_error", "--db", dbPath]);
    expect(stderr).not.toContain("Need --base-url");
  });

  test("program-attached --api: `zond checks run --api foo`", async () => {
    // The bug: --api after `run` is consumed by the program-level option
    // (program.ts), so neither subcommand opts.api nor parent.opts().api
    // see it. Without the readCurrentApi() fallback in resolveBaseUrl this
    // emits "Need --base-url".
    const { stderr } = await runCli(["checks", "run", "--api", "foo", "--check", "not_a_server_error", "--db", dbPath]);
    expect(stderr).not.toContain("Need --base-url");
  });

  test("ZOND_API env: `ZOND_API=foo zond checks run`", async () => {
    process.env.ZOND_API = "foo";
    const { stderr } = await runCli(["checks", "run", "--check", "not_a_server_error", "--db", dbPath]);
    expect(stderr).not.toContain("Need --base-url");
  });

  test("missing all signals still surfaces a usage error (resolveSpecArg fires first)", async () => {
    const { stderr, exitCode } = await runCli(["checks", "run", "--check", "not_a_server_error", "--db", dbPath]);
    // Without --api / ZOND_API / current-api, resolveSpecArg complains
    // before resolveBaseUrl even runs. Either error proves the user is
    // not silently routed to a wrong base_url.
    expect(stderr).toMatch(/Need (a spec|--base-url)/);
    expect(exitCode).toBe(2);
  });
});
