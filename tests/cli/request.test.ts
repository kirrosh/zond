import { describe, test, expect, mock, afterEach } from "bun:test";
import { requestCommand } from "../../src/cli/commands/request.ts";

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
