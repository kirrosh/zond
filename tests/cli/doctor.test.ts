/**
 * Integration test for `zond doctor`. Spawns the CLI against a tmp
 * workspace, registers a tiny API via setupApi (to avoid bringing the
 * full init path into the test), then checks the three exit codes:
 *
 *   0 — required fixtures present + artifacts fresh
 *   1 — required fixture missing (.env.yaml gap)
 *   2 — workspace problem (legacy / missing artifact)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupApi } from "../../src/core/setup-api.ts";
import { closeDb } from "../../src/db/schema.ts";

const MICROSPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "tiny", version: "1.0" },
  servers: [{ url: "https://example.com" }],
  paths: {
    "/users/{id}": {
      get: {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": {} },
      },
    },
  },
});

async function runCli(workspace: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "..", "src", "cli", "index.ts"), ...args], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("zond doctor", () => {
  let workspace: string;
  let savedCwd: string;
  let specPath: string;

  beforeEach(async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-doctor-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    specPath = join(workspace, "tiny-spec.json");
    writeFileSync(specPath, MICROSPEC, "utf-8");
    savedCwd = process.cwd();
    process.chdir(workspace);
    await setupApi({
      name: "tiny",
      spec: specPath,
      dbPath: join(workspace, "zond.db"),
    });
    closeDb();
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  test("exits 0 when fixtures filled and artifacts fresh", async () => {
    // .env.yaml was auto-seeded by setupApi with base_url + path-param defaults
    const r = await runCli(workspace, ["doctor", "--api", "tiny", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/"ok":\s*true/);
  });

  test("exits 1 when a required fixture is unset", async () => {
    // Replace .env.yaml with one that doesn't define base_url / id.
    // (loadEnvFile rejects empty files, so write a placeholder key instead.)
    writeFileSync(join(workspace, "apis", "tiny", ".env.yaml"), "_unused: 1\n", "utf-8");
    const r = await runCli(workspace, ["doctor", "--api", "tiny"]);
    if (r.exitCode !== 1) {
      throw new Error(`Expected exit 1, got ${r.exitCode}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    }
    expect(r.stdout).toContain("UNSET");
  });

  test("exits 2 when local spec.json is missing (legacy / corrupted workspace)", async () => {
    unlinkSync(join(workspace, "apis", "tiny", "spec.json"));
    const r = await runCli(workspace, ["doctor", "--api", "tiny"]);
    // resolveCollectionSpec throws because the local snapshot is gone
    expect(r.exitCode).toBe(2);
    expect(r.stderr + r.stdout).toMatch(/refresh-api/);
  });

  test("spec-less API: exits 0 with mode=run-only and recommendation to attach a spec", async () => {
    // Register a second API by base-url only (no spec).
    await setupApi({
      name: "runonly",
      envVars: { base_url: "https://example.com" },
      dbPath: join(workspace, "zond.db"),
    });
    closeDb();

    const r = await runCli(workspace, ["doctor", "--api", "runonly", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/"mode":\s*"run-only"/);
    expect(r.stdout).toMatch(/refresh-api runonly/);
  });
});
