/**
 * In-process tests for `zond doctor` (TASK-196).
 *
 * Calls `doctorCommand({...})` directly with stdout/stderr captured via
 * `captureOutput`, instead of spawning the CLI. Saves ~4s on the suite
 * and keeps the same exit-code contract (0/1/2) verifiable.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupApi } from "../../src/core/setup-api.ts";
import { closeDb } from "../../src/db/schema.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { captureOutput } from "../_helpers/output";

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

describe("zond doctor", () => {
  let workspace: string;
  let savedCwd: string;
  let specPath: string;
  let dbPath: string;
  let output: ReturnType<typeof captureOutput> | undefined;

  async function runDoctor(opts: Parameters<typeof doctorCommand>[0]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    closeDb();
    output = captureOutput();
    const exitCode = await doctorCommand({ dbPath, ...opts });
    const { out, err } = output;
    output.restore();
    output = undefined;
    closeDb();
    return { exitCode, stdout: out, stderr: err };
  }

  beforeEach(async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-doctor-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    specPath = join(workspace, "tiny-spec.json");
    writeFileSync(specPath, MICROSPEC, "utf-8");
    dbPath = join(workspace, "zond.db");
    savedCwd = process.cwd();
    process.chdir(workspace);
    await setupApi({ name: "tiny", spec: specPath, dbPath });
    // Path-param defaults are seeded as empty (TASK-210) so `skip_if` auto-skips
    // until the user fills them. Doctor treats empty fixtures as UNSET, so for
    // the "healthy workspace" baseline we backfill `id` explicitly.
    writeFileSync(
      join(workspace, "apis", "tiny", ".env.yaml"),
      "base_url: https://example.com\nid: u-1\n",
      "utf-8",
    );
    closeDb();
  });

  afterEach(() => {
    output?.restore();
    output = undefined;
    closeDb();
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  test("exits 0 when fixtures filled and artifacts fresh", async () => {
    const r = await runDoctor({ api: "tiny", json: true });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/"ok":\s*true/);
  });

  test("exits 1 when a required fixture is unset", async () => {
    writeFileSync(join(workspace, "apis", "tiny", ".env.yaml"), "_unused: 1\n", "utf-8");
    const r = await runDoctor({ api: "tiny" });
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("UNSET");
  });

  test("exits 2 when local spec.json is missing (legacy / corrupted workspace)", async () => {
    unlinkSync(join(workspace, "apis", "tiny", "spec.json"));
    const r = await runDoctor({ api: "tiny" });
    expect(r.exitCode).toBe(2);
    expect(r.stderr + r.stdout).toMatch(/refresh-api/);
  });

  test("spec-less API: exits 0 with mode=run-only and recommendation to attach a spec", async () => {
    await setupApi({ name: "runonly", envVars: { base_url: "https://example.com" }, dbPath });
    closeDb();

    const r = await runDoctor({ api: "runonly", json: true });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/"mode":\s*"run-only"/);
    expect(r.stdout).toMatch(/refresh-api runonly/);
  });

  // ARV-201 (R10/F2): spec without `components.securitySchemes` (GitHub-style)
  // must still seed `auth_token: @secret:auth_token` in .env.yaml so the
  // implicit Bearer auto-attach in send-request resolves the token. Before
  // the fix, GitHub's spec left .env.yaml without any auth wiring and every
  // live request 401'd until the user hand-edited the file.
  test("F2: spec without securitySchemes still seeds auth_token in .env.yaml", async () => {
    const envText = await Bun.file(join(workspace, "apis", "tiny", ".env.yaml")).text();
    // NB: setupApi wrote .env.yaml during beforeEach (with no security schemes
    // in MICROSPEC); beforeEach then overwrote it. Re-run setupApi into a
    // clean dir to inspect the freshly-seeded shape.
    const freshDb = join(workspace, "fresh.db");
    await setupApi({ name: "bare", spec: specPath, dbPath: freshDb });
    closeDb();
    const fresh = await Bun.file(join(workspace, "apis", "bare", ".env.yaml")).text();
    expect(fresh).toContain('auth_token: "@secret:auth_token"');
    // Sanity: prior baseline .env.yaml was rewritten by the beforeEach hook
    // and no longer carries auth_token — that's expected and unrelated.
    expect(envText).toBeDefined();
  });

  test("TASK-145: --json data shape pins canonical paths", async () => {
    const r = await runDoctor({ api: "tiny", json: true });
    expect(r.exitCode).toBe(0);
    const env = JSON.parse(r.stdout) as {
      ok: boolean;
      command: string;
      data: {
        api: string;
        spec: { exists: boolean; sha: string | null };
        fixtures: { required: unknown[]; optional: unknown[]; extraInEnv: string[] };
        staleArtifacts: unknown[];
        blockedRequired: number;
        warnings: string[];
      };
    };
    expect(env.ok).toBe(true);
    expect(env.command).toBe("doctor");
    expect(env.data.api).toBe("tiny");
    expect(Array.isArray(env.data.fixtures.required)).toBe(true);
    expect(Array.isArray(env.data.fixtures.optional)).toBe(true);
    expect(Array.isArray(env.data.fixtures.extraInEnv)).toBe(true);
    expect(Array.isArray(env.data.staleArtifacts)).toBe(true);
    expect(typeof env.data.blockedRequired).toBe("number");
    expect((env as Record<string, unknown>).diagnostics).toBeUndefined();
  });

  test("TASK-145: --missing-only hides healthy rows in --json", async () => {
    writeFileSync(join(workspace, "apis", "tiny", ".env.yaml"), "_unused: 1\n", "utf-8");
    const r = await runDoctor({ api: "tiny", json: true, missingOnly: true });
    expect(r.exitCode).toBe(1);
    const env = JSON.parse(r.stdout) as {
      data: {
        fixtures: { required: Array<{ set: boolean }>; optional: unknown[]; extraInEnv: string[] };
        staleArtifacts: Array<{ fresh: boolean }>;
      };
    };
    expect(env.data.fixtures.optional).toEqual([]);
    expect(env.data.fixtures.extraInEnv).toEqual([]);
    for (const f of env.data.fixtures.required) {
      expect(f.set).toBe(false);
    }
    for (const s of env.data.staleArtifacts) {
      expect(s.fresh).toBe(false);
    }
  });

  test("TASK-145: --missing-only on a healthy workspace returns empty groups (text)", async () => {
    const r = await runDoctor({ api: "tiny", missingOnly: true });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/No missing items/);
    expect(r.stdout).not.toMatch(/Optional fixtures/);
  });

  test("TASK-145: --query fixtures.required emits raw JSON subtree", async () => {
    writeFileSync(join(workspace, "apis", "tiny", ".env.yaml"), "_unused: 1\n", "utf-8");
    const r = await runDoctor({ api: "tiny", query: "fixtures.required" });
    expect(r.exitCode).toBe(1);
    const arr = JSON.parse(r.stdout) as Array<{ name: string; set: boolean }>;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThan(0);
    expect(arr[0]).toHaveProperty("name");
    expect(arr[0]).toHaveProperty("set");
  });

  test("TASK-145: --query rejects unknown dot-path", async () => {
    const r = await runDoctor({ api: "tiny", query: "diagnostics.fixtures" });
    expect(r.exitCode).toBe(2);
    expect(r.stderr + r.stdout).toMatch(/did not resolve/);
  });
});
