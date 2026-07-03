/**
 * ARV-308: `zond checks run` exited 1 on any HIGH/CRITICAL finding with no
 * advertised suppress flag, so an orchestrator couldn't tell "found drift"
 * from "command failed" without parsing ndjson. This mirrors `zond run
 * --no-fail-on-failures` (ARV-72). Pins:
 *   1) default exit 1 on a HIGH finding + stderr tail names the flag,
 *   2) --no-fail-on-findings → exit 0 (advisory),
 *   3) --advisory alias → exit 0.
 *
 * The mock server 503s on one endpoint so the seed `not_a_server_error`
 * (severity: high) check produces exactly one HIGH finding.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram, preprocessArgv } from "../../../src/cli/program.ts";
import { closeDb } from "../../../src/db/schema.ts";
import { captureOutput } from "../../_helpers/output";

const spec = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "demo", version: "1" },
  paths: {
    "/explode": { get: { responses: { "200": { description: "ok" } } } },
  },
});

describe("zond checks run: --no-fail-on-findings / --advisory (ARV-308)", () => {
  let workspace: string;
  let specPath: string;
  let baseUrl: string;
  let savedCwd: string;
  let exitSpy: typeof process.exit;
  let lastExit: number | undefined;
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-checks-arv308-")));
    savedCwd = process.cwd();
    process.chdir(workspace);
    specPath = join(workspace, "spec.json");
    writeFileSync(specPath, spec);
    server = Bun.serve({ port: 0, fetch() { return new Response("boom", { status: 503 }); } });
    baseUrl = `http://localhost:${server.port}`;

    exitSpy = process.exit;
    lastExit = undefined;
    // First exit wins: the real process.exit terminates, so checksRunAction's
    // own try/catch never sees it. Our throwing stub *is* caught there and
    // re-triggers process.exit(2) — recording only the first call models the
    // real (single) exit faithfully.
    process.exit = ((code?: number) => {
      if (lastExit === undefined) lastExit = typeof code === "number" ? code : 0;
      throw new Error(`__exit__`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = exitSpy;
    server.stop(true);
    closeDb();
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  async function runCli(argv: string[]): Promise<{ stderr: string; exitCode: number | undefined }> {
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
    const { err } = cap;
    cap.restore();
    const ec = lastExit !== undefined ? lastExit : (process.exitCode === undefined ? 0 : Number(process.exitCode));
    process.exitCode = 0;
    return { stderr: err, exitCode: ec };
  }

  const base = () => ["checks", "run", "--spec", specPath, "--base-url", baseUrl, "--check", "not_a_server_error"];

  test("default: HIGH finding → exit 1 and stderr tail names the flag", async () => {
    const { stderr, exitCode } = await runCli(base());
    expect(exitCode).toBe(1);
    expect(stderr).toContain("HIGH/CRITICAL finding");
    expect(stderr).toContain("--no-fail-on-findings");
  });

  test("--no-fail-on-findings: same finding → exit 0", async () => {
    const { exitCode } = await runCli([...base(), "--no-fail-on-findings"]);
    expect(exitCode).toBe(0);
  });

  test("--advisory alias → exit 0", async () => {
    const { exitCode } = await runCli([...base(), "--advisory"]);
    expect(exitCode).toBe(0);
  });
});
