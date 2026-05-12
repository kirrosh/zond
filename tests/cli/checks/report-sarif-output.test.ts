/**
 * ARV-118 (m-19): pin the SARIF output path resolution after the
 * OutputSpec migration. AC #2 (`--report sarif --output <path>` writes
 * to that path) and AC #3 (`--report sarif` without `--output` falls
 * back to the spec's `defaultFilename` — `zond-checks.sarif`).
 *
 * Before the migration the SARIF branch read `opts.output ?? "zond-checks.sarif"`
 * inline. Resolving the same default through the typed OutputSpec keeps
 * the contract uniform with `run`, `probe`, etc. — but the integration
 * point is new, so this test guards it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupApi } from "../../../src/core/setup-api.ts";
import { closeDb } from "../../../src/db/schema.ts";
import { buildProgram, preprocessArgv } from "../../../src/cli/program.ts";
import { captureOutput } from "../../_helpers/output";

describe("checks run: --report sarif output policy (ARV-118)", () => {
  let workspace: string;
  let savedCwd: string;
  let dbPath: string;
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let exitSpy: typeof process.exit;
  let lastExit: number | undefined;

  beforeEach(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/ping" && req.method === "GET") {
          return Response.json({ ok: true });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-checks-sarif-out-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n");
    const specPath = join(workspace, "spec.json");
    writeFileSync(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "tiny", version: "1.0" },
      servers: [{ url: baseUrl }],
      paths: { "/ping": { get: { responses: { "200": { description: "ok" } } } } },
    }));
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
    server.stop(true);
  });

  async function runCli(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | undefined }> {
    const cap = captureOutput({ console: true });
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

  test("AC #2: --report sarif --output <path> writes to that path", async () => {
    const outPath = join(workspace, "custom.sarif");
    const { stderr } = await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--base-url", baseUrl,
      "--report", "sarif", "--output", outPath, "--db", dbPath,
    ]);

    expect(existsSync(outPath)).toBe(true);
    expect(stderr).toContain("SARIF report written to");
    expect(stderr).toContain(outPath);

    const parsed = JSON.parse(readFileSync(outPath, "utf-8")) as { version?: string; runs?: unknown[] };
    expect(parsed.version).toBe("2.1.0");
    expect(Array.isArray(parsed.runs)).toBe(true);
  });

  test("AC #3: --report sarif without --output uses zond-checks.sarif", async () => {
    const defaultPath = join(workspace, "zond-checks.sarif");
    expect(existsSync(defaultPath)).toBe(false);

    const { stderr } = await runCli([
      "checks", "run", "--api", "foo", "--check", "not_a_server_error",
      "--base-url", baseUrl,
      "--report", "sarif", "--db", dbPath,
    ]);

    expect(existsSync(defaultPath)).toBe(true);
    expect(stderr).toContain("SARIF report written to");
    const parsed = JSON.parse(readFileSync(defaultPath, "utf-8")) as { version?: string };
    expect(parsed.version).toBe("2.1.0");
  });
});
