import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { executeRequest } from "../../src/core/runner/http-client.ts";

describe("executeRequest", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends GET request and returns structured response", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ id: 1, name: "John" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const response = await executeRequest({
      method: "GET",
      url: "http://example.com/users/1",
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(response.body_parsed).toEqual({ id: 1, name: "John" });
    expect(response.headers["content-type"]).toBe("application/json");
    expect(response.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("sends POST with body", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    await executeRequest({
      method: "POST",
      url: "http://example.com/users",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "John" }),
    });

    expect(capturedInit!.method).toBe("POST");
    expect(capturedInit!.body).toBe('{"name":"John"}');
  });

  test("parses JSON response when content-type is application/json", async () => {
    globalThis.fetch = mock(async () => {
      return new Response('{"key": "value"}', {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }) as unknown as typeof fetch;

    const response = await executeRequest({ method: "GET", url: "http://example.com", headers: {} });
    expect(response.body_parsed).toEqual({ key: "value" });
  });

  test("does not parse body when content-type is not JSON", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("<html>Hello</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }) as unknown as typeof fetch;

    const response = await executeRequest({ method: "GET", url: "http://example.com", headers: {} });
    expect(response.body_parsed).toBeUndefined();
    expect(response.body).toBe("<html>Hello</html>");
  });

  test("retries on network error and succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) throw new Error("Network error");
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const response = await executeRequest(
      { method: "GET", url: "http://example.com", headers: {} },
      { retries: 1, retry_delay: 10 },
    );
    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("throws after all retries exhausted", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    }) as unknown as typeof fetch;

    await expect(
      executeRequest(
        { method: "GET", url: "http://example.com", headers: {} },
        { retries: 1, retry_delay: 10 },
      ),
    ).rejects.toThrow("Network error");
  });

  test("does NOT retry on HTTP error status", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response("Not Found", { status: 404, headers: {} });
    }) as unknown as typeof fetch;

    const response = await executeRequest(
      { method: "GET", url: "http://example.com", headers: {} },
      { retries: 2, retry_delay: 10 },
    );
    expect(response.status).toBe(404);
    expect(callCount).toBe(1); // Only one call — no retry on HTTP errors
  });

  test("timeout aborts the request", async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      // Simulate slow response
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
      return new Response("{}", { status: 200, headers: {} });
    }) as unknown as typeof fetch;

    await expect(
      executeRequest(
        { method: "GET", url: "http://example.com", headers: {} },
        { timeout: 50 },
      ),
    ).rejects.toThrow();
  });
});
