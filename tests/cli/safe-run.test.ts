import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { closeDb } from "../../src/db/schema.ts";

const FIXTURES = `${import.meta.dir}/../fixtures`;
const originalFetch = globalThis.fetch;

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

function mockFetchResponses(responses: Array<{ status: number; body: unknown }>) {
  let callIndex = 0;
  globalThis.fetch = mock(async () => {
    const resp = responses[callIndex++] ?? { status: 500, body: { error: "unexpected call" } };
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = mock(() => true) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  return () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
}

describe("--safe mode", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = suppressOutput();
  });

  afterEach(() => {
    restore();
    globalThis.fetch = originalFetch;
    closeDb();
  });

  test("safe mode runs only GET tests from crud suite", async () => {
    // crud.yaml has POST, GET, DELETE — safe mode should only run GET
    mockFetchResponses([
      { status: 200, body: { id: 1, name: "John", email: "john@test.com" } },
    ]);

    const code = await runCommand({
      path: `${FIXTURES}/crud.yaml`,
      env: undefined,
      report: "json",
      bail: false,
      noDb: true,
      safe: true,
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    // Only the GET test should have run (1 call)
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  test("safe mode with GET-only suite runs normally", async () => {
    // simple.yaml has only GET /health
    mockFetchResponses([
      { status: 200, body: { status: "ok" } },
    ]);

    const code = await runCommand({
      path: `${FIXTURES}/simple.yaml`,
      report: "json",
      bail: false,
      noDb: true,
      safe: true,
    });

    expect(code).toBe(0);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  test("safe mode returns 0 when no GET tests found", async () => {
    const code = await runCommand({
      path: `${FIXTURES}/post-only.yaml`,
      report: "console",
      bail: false,
      noDb: true,
      safe: true,
    });

    // Should return 0 (warning printed but no error)
    expect(code).toBe(0);
  });
});
