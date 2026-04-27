import { describe, test, expect, mock, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { runCommand } from "../../src/cli/commands/run.ts";
import { validateCommand } from "../../src/cli/commands/validate.ts";
import { closeDb } from "../../src/db/schema.ts";

function tryUnlink(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* ignore on Windows */ }
  }
}

const FIXTURES = `${import.meta.dir}/../fixtures`;
const originalFetch = globalThis.fetch;

// Helper to mock fetch responses
function mockFetchResponses(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let callIndex = 0;
  globalThis.fetch = mock(async () => {
    const resp = responses[callIndex++] ?? { status: 500, body: { error: "unexpected call" } };
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { "Content-Type": "application/json", ...resp.headers },
    });
  }) as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// Suppress stdout/stderr during tests
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

function tmpDb(): string {
  return join(tmpdir(), `zond-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("runCommand", () => {
  let restore: () => void;

  afterEach(() => {
    restore?.();
    restoreFetch();
    closeDb();
  });

  test("returns 0 when all tests pass", async () => {
    mockFetchResponses([{ status: 200, body: { id: 1 } }]);
    restore = suppressOutput();

    const code = await runCommand({
      path: `${FIXTURES}/simple.yaml`,
      report: "console",
      bail: false,
      noDb: true,
    });
    expect(code).toBe(0);
  });

  test("returns 1 when a test fails", async () => {
    // simple.yaml expects status 200, we return 500
    mockFetchResponses([{ status: 500, body: { error: "fail" } }]);
    restore = suppressOutput();

    const code = await runCommand({
      path: `${FIXTURES}/simple.yaml`,
      report: "console",
      bail: false,
      noDb: true,
    });
    expect(code).toBe(1);
  });

  test("returns 2 for invalid path", async () => {
    restore = suppressOutput();

    const code = await runCommand({
      path: `${FIXTURES}/nonexistent.yaml`,
      report: "console",
      bail: false,
      noDb: true,
    });
    expect(code).toBe(2);
  });

  test("--timeout overrides suite config", async () => {
    mockFetchResponses([{ status: 200, body: {} }]);
    restore = suppressOutput();

    const code = await runCommand({
      path: `${FIXTURES}/simple.yaml`,
      report: "json",
      timeout: 1000,
      bail: false,
      noDb: true,
    });
    expect(code).toBe(0);
  });

  test("works with json reporter", async () => {
    mockFetchResponses([{ status: 200, body: {} }]);

    let output = "";
    const origLog = console.log;
    const origErr = process.stderr.write;
    console.log = mock((...args: unknown[]) => {
      output += args.map(String).join(" ") + "\n";
    });
    process.stderr.write = mock(() => true) as typeof process.stderr.write;
    restore = () => {
      console.log = origLog;
      process.stderr.write = origErr;
    };

    const code = await runCommand({
      path: `${FIXTURES}/simple.yaml`,
      report: "json",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(0);
    const parsed = JSON.parse(output.trim());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].suite_name).toBe("Health Check");
  });

  test("works with junit reporter", async () => {
    mockFetchResponses([{ status: 200, body: {} }]);

    let output = "";
    const origLog = console.log;
    const origErr = process.stderr.write;
    console.log = mock((...args: unknown[]) => {
      output += args.map(String).join(" ") + "\n";
    });
    process.stderr.write = mock(() => true) as typeof process.stderr.write;
    restore = () => {
      console.log = origLog;
      process.stderr.write = origErr;
    };

    const code = await runCommand({
      path: `${FIXTURES}/simple.yaml`,
      report: "junit",
      bail: false,
      noDb: true,
    });

    expect(code).toBe(0);
    expect(output).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(output).toContain("<testsuites");
    expect(output).toContain("Health Check");
  });

  test("bail stops after first failed suite", async () => {
    // bail/ directory has 2 YAML files, each expects status 200
    // We return 500 so both would fail, but bail should stop after first
    let fetchCallCount = 0;
    globalThis.fetch = mock(async () => {
      fetchCallCount++;
      return new Response(JSON.stringify({ error: "fail" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    restore = suppressOutput();

    const code = await runCommand({
      path: `${FIXTURES}/bail`,
      report: "console",
      bail: true,
      noDb: true,
    });

    expect(code).toBe(1);
    // With bail, only the first suite should have run
    expect(fetchCallCount).toBe(1);
  });

  test("saves results to DB when noDb is false", async () => {
    mockFetchResponses([{ status: 200, body: {} }]);
    const db = tmpDb();
    restore = suppressOutput();

    try {
      const code = await runCommand({
        path: `${FIXTURES}/simple.yaml`,
        report: "console",
        bail: false,
        noDb: false,
        dbPath: db,
      });
      expect(code).toBe(0);
      expect(existsSync(db)).toBe(true);

      const { getDb } = await import("../../src/db/schema.ts");
      const runs = getDb(db).query("SELECT * FROM runs").all();
      expect(runs).toHaveLength(1);
    } finally {
      closeDb();
      tryUnlink(db);
    }
  });

  test("--no-db skips DB creation", async () => {
    mockFetchResponses([{ status: 200, body: {} }]);
    const db = tmpDb();
    restore = suppressOutput();

    const code = await runCommand({
      path: `${FIXTURES}/simple.yaml`,
      report: "console",
      bail: false,
      noDb: true,
      dbPath: db,
    });

    expect(code).toBe(0);
    expect(existsSync(db)).toBe(false);
  });
});

describe("validateCommand", () => {
  let restore: () => void;

  afterEach(() => {
    restore?.();
  });

  test("returns 0 for valid YAML", async () => {
    restore = suppressOutput();
    const code = await validateCommand({ path: `${FIXTURES}/simple.yaml` });
    expect(code).toBe(0);
  });

  test("returns 2 for invalid YAML", async () => {
    restore = suppressOutput();
    const code = await validateCommand({ path: `${FIXTURES}/invalid-missing-name.yaml` });
    expect(code).toBe(2);
  });

  test("returns 0 for valid directory", async () => {
    restore = suppressOutput();
    const code = await validateCommand({ path: `${FIXTURES}/valid` });
    expect(code).toBe(0);
  });

  test("returns 2 for nonexistent path", async () => {
    restore = suppressOutput();
    const code = await validateCommand({ path: `${FIXTURES}/nonexistent.yaml` });
    expect(code).toBe(2);
  });
});

describe("runCommand with --auth-token", () => {
  let restore: () => void;

  afterEach(() => {
    restore?.();
    restoreFetch();
    closeDb();
  });

  test("auth token is injected into requests via env", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(Object.entries(init?.headers ?? {}));
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    restore = suppressOutput();

    const code = await runCommand({
      path: `${FIXTURES}/auth-token-test.yaml`,
      report: "console",
      bail: false,
      noDb: true,
      authToken: "test-jwt-token-123",
    });

    // The test file should use {{auth_token}} in Authorization header
    expect(capturedHeaders["Authorization"]).toBe("Bearer test-jwt-token-123");
    expect(code).toBe(0);
  });
});
