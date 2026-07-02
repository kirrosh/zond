/**
 * ARV-303: when `coverage --api <X>` resolves a selector to zero runs
 * (closed session, --session-id pointing at a session with no runs,
 * --union tag with no matches), the JSON envelope must be ok:false so
 * the non-zero exit code lines up with the envelope shape. Previously
 * we emitted ok:true with covered=0, total=N, alongside exit 1.
 *
 * Spec-only fallback (no --api) is intentionally NOT covered here —
 * TASK-250 locks its ok:true behaviour because the legacy contract
 * there is "spec parsed, here's a 0% snapshot".
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { captureOutput } from "../_helpers/output";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { createCollection, findCollectionByNameOrId } from "../../src/db/queries.ts";
import { beginAuditRun, finalizeAuditRun } from "../../src/core/audit/persist.ts";
import { coverageCommand } from "../../src/cli/commands/coverage.ts";

const minimalSpec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "demo", version: "1" },
  paths: {
    "/things": {
      get: { responses: { "200": { description: "ok" } } },
    },
    "/other": {
      get: { responses: { "200": { description: "ok" } } },
    },
  },
});

describe("ARV-303: matrix-coverage no-runs envelope contract", () => {
  let workdir: string;
  let dbPath: string;
  let prevCwd: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "zond-cov-arv303-"));
    prevCwd = process.cwd();
    process.chdir(workdir);
    const apiDir = join(workdir, "apis", "demo");
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, "spec.json"), minimalSpec);
    dbPath = join(workdir, "zond.db");
    getDb(dbPath);
    createCollection({
      name: "demo",
      test_path: join(apiDir, "tests"),
      openapi_spec: join(apiDir, "spec.json"),
      base_dir: apiDir,
    });
  });

  afterEach(() => {
    closeDb();
    process.chdir(prevCwd);
    rmSync(workdir, { recursive: true, force: true });
  });

  test("--session-id of a non-existent session → envelope ok:false + exit 1", async () => {
    const cap = captureOutput({ console: true });
    try {
      const code = await coverageCommand({
        apiName: "demo",
        sessionId: "no-such-session",
        json: true,
      });
      expect(code).toBe(1);
      const env = JSON.parse(cap.out.trim());
      expect(env.ok).toBe(false);
      expect(env.command).toBe("coverage");
      expect(env.errors?.[0]?.message).toMatch(/no runs|cannot be computed/i);
    } finally {
      cap.restore();
    }
  });

  test("resolvable run with uncovered endpoints → envelope ok:true + exit 0", async () => {
    // ARV-303 corroboration: a run resolves (covered 1/2), yet the pre-fix
    // path returned exit 1 because uncovered endpoints remained — while the
    // envelope said ok:true. An orchestrator can't tell that from a crash.
    const collectionId = findCollectionByNameOrId("demo")!.id;
    const runId = beginAuditRun({ runKind: "regular", collectionId });
    finalizeAuditRun(runId, [{
      suiteName: "smoke",
      testName: "GET /things",
      status: "pass",
      request: { method: "GET", url: "https://api.test/things", headers: {} },
      response: { status: 200, headers: {}, body: "{}", duration_ms: 1 },
      durationMs: 1,
    }]);

    const cap = captureOutput({ console: true });
    try {
      const code = await coverageCommand({ apiName: "demo", json: true });
      expect(code).toBe(0);
      const env = JSON.parse(cap.out.trim());
      expect(env.ok).toBe(true);
      expect(env.data.uncovered).toBeGreaterThan(0);
    } finally {
      cap.restore();
    }
  });
});
