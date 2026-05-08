import { describe, test, expect, mock, afterEach } from "bun:test";
import { join } from "node:path";
import { requestCommand } from "../../src/cli/commands/request.ts";
import { setupApi } from "../../src/core/setup-api.ts";
import { closeDb } from "../../src/db/schema.ts";

import { captureOutput } from "../_helpers/output";
import { restoreFetch } from "../_helpers/fetch-mock";
import { makeWorkspace } from "../_helpers/workspace";

describe("requestCommand", () => {
  let output: ReturnType<typeof captureOutput>;

  afterEach(() => {
    output?.restore();
    restoreFetch();
  });

  test("sends GET request and returns JSON envelope", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;

    output = captureOutput({ console: true });

    const code = await requestCommand({
      method: "GET",
      url: "http://localhost/test",
      json: true,
    });

    expect(code).toBe(0);
    const envelope = JSON.parse(output.out);
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

    output = captureOutput({ console: true });

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
    const ws = makeWorkspace({ prefix: "zond-req-", marker: "config", chdir: true });
    const workspace = ws.path;
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

      output = captureOutput({ console: true });

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
      ws.cleanup();
    }
  });

  test("--api unknown gives actionable error", async () => {
    const ws = makeWorkspace({ prefix: "zond-req-", marker: "config", chdir: true });
    const workspace = ws.path;
    try {
      output = captureOutput({ console: true });
      const code = await requestCommand({
        method: "GET",
        url: "/users/1",
        api: "ghost",
        dbPath: join(workspace, "zond.db"),
        json: true,
      });
      expect(code).toBe(1);
      const envelope = JSON.parse(output.out);
      expect(envelope.ok).toBe(false);
      expect(envelope.errors[0]).toMatch(/not registered/);
      expect(envelope.errors[0]).toMatch(/zond add api/);
    } finally {
      closeDb();
      ws.cleanup();
    }
  });

  // TASK-272 — auto-auth hint discoverability
  test("on 401 without --api in apis/ workspace prints --api hint to stderr", async () => {
    const ws = makeWorkspace({ prefix: "zond-req-hint-", marker: "config", chdir: true });
    try {
      // create apis/sentry/ to trigger the hint
      const fs = await import("node:fs");
      fs.mkdirSync(join(ws.path, "apis", "sentry"), { recursive: true });

      globalThis.fetch = mock(async () =>
        new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } })
      ) as unknown as typeof fetch;

      output = captureOutput({ console: true });
      const code = await requestCommand({
        method: "GET",
        url: "http://localhost/x",
        // no api set
      });
      expect(code).toBe(0);
      expect(output.err).toMatch(/--api sentry/);
      expect(output.err).toMatch(/auto-load Authorization/);
    } finally {
      closeDb();
      ws.cleanup();
    }
  });

  test("no --api hint when apis/ workspace is absent", async () => {
    const ws = makeWorkspace({ prefix: "zond-req-no-hint-", marker: "config", chdir: true });
    try {
      globalThis.fetch = mock(async () =>
        new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } })
      ) as unknown as typeof fetch;

      output = captureOutput({ console: true });
      await requestCommand({ method: "GET", url: "http://localhost/x" });
      expect(output.err).not.toMatch(/--api/);
    } finally {
      closeDb();
      ws.cleanup();
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

    output = captureOutput({ console: true });

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
