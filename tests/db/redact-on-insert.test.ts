import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDb, closeDb } from "../../src/db/schema.ts";
import { createRun, saveResults } from "../../src/db/queries.ts";
import { SecretRegistry, setSecretRegistry } from "../../src/core/secrets/registry.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "zond-redact-db-"));
  closeDb();
  getDb(join(workdir, "zond.db"));
  // Reset the registry between tests so values don't leak.
  setSecretRegistry(new SecretRegistry());
});

afterEach(() => {
  closeDb();
  rmSync(workdir, { recursive: true, force: true });
});

const SECRET = "Bearer-abcd1234efgh5678";

function makeRunResult(): TestRunResult {
  return {
    suite_name: "leaky",
    suite_file: "leaky.yaml",
    file: "leaky.yaml",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    steps: [
      {
        name: "echo",
        status: "fail",
        duration_ms: 10,
        request: {
          method: "POST",
          url: `https://api.example.com/login?token=${SECRET}`,
          body: `{"refresh":"${SECRET}"}`,
        },
        response: {
          status: 401,
          body: `{"error":"invalid","echo":"${SECRET}"}`,
          headers: { "set-cookie": `session=${SECRET}` },
        },
        error: `unauthorized: ${SECRET}`,
        assertions: [{
          rule: "equals 200",
          passed: false,
          actual: 401,
          expected: 200,
          kind: "primary",
        } as any],
        captures: { last_token: SECRET },
        provenance: null,
        spec_pointer: null,
        spec_excerpt: `bearer ${SECRET} should not be here`,
      } as any,
    ],
  };
}

function fetchRow(runId: number) {
  const db = getDb();
  return db.query("SELECT * FROM results WHERE run_id = ?").get(runId) as any;
}

describe("DB-write sanitizer (TASK-167)", () => {
  test("registered token is redacted across every string field", () => {
    const reg = new SecretRegistry();
    reg.register("auth_token", SECRET);
    setSecretRegistry(reg);

    const runId = createRun({ started_at: new Date().toISOString(), trigger: "manual" });
    saveResults(runId, [makeRunResult()]);

    const row = fetchRow(runId);
    expect(row.request_url).not.toInclude(SECRET);
    expect(row.request_url).toInclude("<redacted:auth_token>");
    expect(row.request_body).not.toInclude(SECRET);
    expect(row.response_body).not.toInclude(SECRET);
    expect(row.response_headers).not.toInclude(SECRET);
    expect(row.error_message).not.toInclude(SECRET);
    expect(row.assertions ?? "").not.toInclude(SECRET);
    expect(row.captures).not.toInclude(SECRET);
    expect(row.spec_excerpt).not.toInclude(SECRET);
  });

  test("--no-redact (registry disabled) preserves raw values", () => {
    const reg = new SecretRegistry();
    reg.register("auth_token", SECRET);
    reg.setEnabled(false);
    setSecretRegistry(reg);

    const runId = createRun({ started_at: new Date().toISOString(), trigger: "manual" });
    saveResults(runId, [makeRunResult()]);

    const row = fetchRow(runId);
    expect(row.request_url).toInclude(SECRET);
    expect(row.response_body).toInclude(SECRET);
  });

  test("empty registry leaves rows untouched (no-op fast path)", () => {
    setSecretRegistry(new SecretRegistry());

    const runId = createRun({ started_at: new Date().toISOString(), trigger: "manual" });
    saveResults(runId, [makeRunResult()]);

    const row = fetchRow(runId);
    expect(row.response_body).toInclude(SECRET);
  });
});
