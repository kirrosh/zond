/**
 * ARV-119 (m-19): pin the unified --report / --output resolution that
 * now backs `probe mass-assignment` and `probe security`. Both
 * subcommands delegate to `PROBE_OUTPUT_SPEC` via `resolveOutput()`, so
 * an unknown `--report` value produces the same one-line error on
 * stderr (and JSON envelope when `--json` is set) regardless of which
 * probe was invoked.
 *
 * Before the migration, each subcommand silently coerced anything that
 * wasn't `"json"` into `"markdown"` (`opts.report === "json" ? "json" :
 * "markdown"`) — a typo like `--report jason` produced a markdown
 * digest with no warning. The OutputSpec now rejects unknown formats
 * up-front with the canonical "Available: markdown, json" message.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProgram, preprocessArgv } from "../../src/cli/program.ts";
import { captureOutput } from "../_helpers/output";

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "tiny", version: "1.0" },
  servers: [{ url: "http://127.0.0.1:1/" }],
  paths: { "/ping": { get: { responses: { "200": { description: "ok" } } } } },
});

describe("ARV-119: probe family --report resolution", () => {
  let workspace: string;
  let savedCwd: string;
  let specPath: string;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-probe-output-spec-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n");
    specPath = join(workspace, "spec.json");
    writeFileSync(specPath, SPEC);
    savedCwd = process.cwd();
    process.chdir(workspace);
    // Force-exit suppression so the parseAsync chain can keep running
    // after the subcommand sets process.exitCode = 2.
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  async function runCli(argv: string[]): Promise<{ stdout: string; stderr: string }> {
    const cap = captureOutput({ console: true });
    const program = buildProgram();
    try {
      await program.parseAsync(preprocessArgv(["bun", "zond", ...argv]));
    } catch (err) {
      // Commander throws on unknown options; resolveOutput errors stay
      // inside the action and set process.exitCode without throwing.
      if (!(err instanceof Error) || !err.message.startsWith("__exit_")) {
        // ignore — the test asserts on captured stderr / envelopes.
      }
    }
    const { out, err } = cap;
    cap.restore();
    return { stdout: out, stderr: err };
  }

  test("probe mass-assignment --report jason → uniform OutputSpec error", async () => {
    const { stderr } = await runCli([
      "probe", "mass-assignment", specPath, "--dry-run",
      "--report", "jason",
    ]);
    expect(stderr).toContain("Unknown --report format");
    expect(stderr).toContain("jason");
    expect(stderr).toContain("markdown");
    expect(stderr).toContain("json");
  });

  test("probe security --report jason → same uniform error", async () => {
    const { stderr } = await runCli([
      "probe", "security", "ssrf", specPath, "--dry-run",
      "--report", "jason",
    ]);
    expect(stderr).toContain("Unknown --report format");
    expect(stderr).toContain("jason");
  });

  test("probe mass-assignment --report markdown is still the default-equivalent (no error)", async () => {
    const { stderr } = await runCli([
      "probe", "mass-assignment", specPath, "--dry-run",
      "--report", "markdown",
    ]);
    expect(stderr).not.toContain("Unknown --report format");
  });

  // ARV-321: --emit-tests + --dry-run silently no-op'd (target dir stayed
  // empty, zero signal) — read as a bug on the live Stripe run
  // (report-zond friction, 2026-07-02). Both probe families now warn.
  test("probe mass-assignment --dry-run --emit-tests warns it's a no-op", async () => {
    const { stderr } = await runCli([
      "probe", "mass-assignment", specPath, "--dry-run",
      "--emit-tests", join(workspace, "emitted"),
    ]);
    expect(stderr).toContain("--emit-tests skipped");
    expect(stderr).toContain("--dry-run");
  });

  test("probe security --dry-run --emit-tests warns it's a no-op", async () => {
    const { stderr } = await runCli([
      "probe", "security", "ssrf", specPath, "--dry-run",
      "--emit-tests", join(workspace, "emitted"),
    ]);
    expect(stderr).toContain("--emit-tests skipped");
    expect(stderr).toContain("--dry-run");
  });

  test("probe mass-assignment --dry-run without --emit-tests stays silent about it", async () => {
    const { stderr } = await runCli(["probe", "mass-assignment", specPath, "--dry-run"]);
    expect(stderr).not.toContain("--emit-tests skipped");
  });
});
