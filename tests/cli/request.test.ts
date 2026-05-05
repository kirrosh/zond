import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestCommand } from "../../src/cli/commands/request.ts";
import { setupApi } from "../../src/core/setup-api.ts";
import { closeDb } from "../../src/db/schema.ts";

const originalFetch = globalThis.fetch;

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const origLog = console.log;
  let captured = "";
  process.stdout.write = mock((data: any) => { captured += String(data); return true; }) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  console.log = mock((...args: unknown[]) => { captured += args.map(String).join(" ") + "\n"; });
  return {
    restore() {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      console.log = origLog;
    },
    getCaptured() { return captured; },
  };
}

describe("requestCommand", () => {
  let output: ReturnType<typeof suppressOutput>;

  afterEach(() => {
    output?.restore();
    globalThis.fetch = originalFetch;
  });

  test("sends GET request and returns JSON envelope", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;

    output = suppressOutput();

    const code = await requestCommand({
      method: "GET",
      url: "http://localhost/test",
      json: true,
    });

    expect(code).toBe(0);
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe(200);
    expect(envelope.data.body.hello).toBe("world");
  });

  test("sends POST with body", async () => {
    let capturedBody = "";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify({ created: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    output = suppressOutput();

    const code = await requestCommand({
      method: "POST",
      url: "http://localhost/test",
      body: '{"name":"test"}',
      json: true,
    });

    expect(code).toBe(0);
    expect(capturedBody).toBe('{"name":"test"}');
  });

  test("--api with relative path auto-prefixes base_url from .env.yaml", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-req-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    const savedCwd = process.cwd();
    process.chdir(workspace);
    try {
      await setupApi({
        name: "jp",
        envVars: { base_url: "https://example.com" },
        dbPath: join(workspace, "zond.db"),
      });
      closeDb();

      let calledUrl = "";
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        calledUrl = String(url);
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }) as unknown as typeof fetch;

      output = suppressOutput();

      const code = await requestCommand({
        method: "GET",
        url: "/users/1",
        api: "jp",
        dbPath: join(workspace, "zond.db"),
        json: true,
      });

      expect(code).toBe(0);
      expect(calledUrl).toBe("https://example.com/users/1");
    } finally {
      closeDb();
      process.chdir(savedCwd);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("--api unknown gives actionable error", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-req-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n", "utf-8");
    const savedCwd = process.cwd();
    process.chdir(workspace);
    try {
      output = suppressOutput();
      const code = await requestCommand({
        method: "GET",
        url: "/users/1",
        api: "ghost",
        dbPath: join(workspace, "zond.db"),
        json: true,
      });
      expect(code).toBe(1);
      const envelope = JSON.parse(output.getCaptured());
      expect(envelope.ok).toBe(false);
      expect(envelope.errors[0]).toMatch(/not registered/);
      expect(envelope.errors[0]).toMatch(/zond add api/);
    } finally {
      closeDb();
      process.chdir(savedCwd);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("sends request with headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(Object.entries(init?.headers ?? {}));
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    output = suppressOutput();

    const code = await requestCommand({
      method: "GET",
      url: "http://localhost/test",
      headers: ["Authorization: Bearer token123"],
      json: true,
    });

    expect(code).toBe(0);
    expect(capturedHeaders["Authorization"]).toBe("Bearer token123");
  });
});
