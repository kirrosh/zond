import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvironment, loadEnvMeta } from "../../src/core/parser/variables.ts";
import { _resetWorkspaceWarning } from "../../src/core/workspace/root.ts";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "zond-env-walkup-"));
  // Mark as workspace root via apis/ marker
  mkdirSync(join(workspace, "apis"), { recursive: true });
  _resetWorkspaceWarning();
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("loadEnvironment walk-up to workspace root", () => {
  test("picks up .env.yaml from workspace root when test sits in apis/<name>/probes/foo/", async () => {
    writeFileSync(join(workspace, ".env.yaml"), "auth_token: root-token\nbase_url: https://api.example.com\n");
    const probeDir = join(workspace, "apis", "myapi", "probes", "validation");
    mkdirSync(probeDir, { recursive: true });

    const env = await loadEnvironment(undefined, probeDir);
    expect(env.auth_token).toBe("root-token");
    expect(env.base_url).toBe("https://api.example.com");
  });

  test("deeper .env.yaml overrides shallower on key collision", async () => {
    writeFileSync(join(workspace, ".env.yaml"), "auth_token: root-token\nshared: from-root\n");
    const apiDir = join(workspace, "apis", "myapi");
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, ".env.yaml"), "auth_token: api-token\n");

    const env = await loadEnvironment(undefined, apiDir);
    expect(env.auth_token).toBe("api-token");          // deeper wins
    expect(env.shared).toBe("from-root");              // shallow inherited
  });

  test("does not climb past workspace root", async () => {
    // Place an env file in the *parent* of workspace — it must NOT be loaded.
    const parentEnv = join(workspace, "..");
    const decoy = join(parentEnv, ".env.yaml");
    // Skip the assertion if we can't safely write to the parent (e.g. permission).
    try {
      writeFileSync(decoy, "leaked: yes\n");
    } catch {
      return;
    }
    try {
      writeFileSync(join(workspace, ".env.yaml"), "auth_token: ok\n");
      const probeDir = join(workspace, "apis", "myapi", "tests");
      mkdirSync(probeDir, { recursive: true });

      const env = await loadEnvironment(undefined, probeDir);
      expect(env.auth_token).toBe("ok");
      expect(env.leaked).toBeUndefined();
    } finally {
      rmSync(decoy, { force: true });
    }
  });

  test("loadEnvMeta walks up too — rateLimit from root applies to deep tests", async () => {
    writeFileSync(join(workspace, ".env.yaml"), "rateLimit: 3\n");
    const probeDir = join(workspace, "apis", "myapi", "probes", "validation");
    mkdirSync(probeDir, { recursive: true });

    const meta = await loadEnvMeta(undefined, probeDir);
    expect(meta.rateLimit).toBe(3);
  });
});
