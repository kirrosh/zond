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

  test("stores raw text as body_parsed when content-type is not JSON", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("<html>Hello</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }) as unknown as typeof fetch;

    const response = await executeRequest({ method: "GET", url: "http://example.com", headers: {} });
    expect(response.body_parsed).toBe("<html>Hello</html>");
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

  test("retries on 429 and respects Retry-After (seconds)", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "1" },
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const start = Date.now();
    const response = await executeRequest(
      { method: "GET", url: "http://example.com", headers: {} },
      { rate_limit_retries: 3, retry_delay: 1, rate_limit_max_delay_ms: 5000 },
    );
    const elapsed = Date.now() - start;
    expect(response.status).toBe(200);
    expect(callCount).toBe(2);
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  test("retries on 429 with exponential backoff when no Retry-After", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response("rate limited", { status: 429, headers: {} });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const response = await executeRequest(
      { method: "GET", url: "http://example.com", headers: {} },
      { rate_limit_retries: 5, retry_delay: 5, rate_limit_max_delay_ms: 100 },
    );
    expect(response.status).toBe(200);
    expect(callCount).toBe(3);
  });

  test("returns 429 after exhausting rate-limit retries", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    }) as unknown as typeof fetch;

    const response = await executeRequest(
      { method: "GET", url: "http://example.com", headers: {} },
      { rate_limit_retries: 2, retry_delay: 1, rate_limit_max_delay_ms: 50 },
    );
    expect(response.status).toBe(429);
    expect(callCount).toBe(3); // initial + 2 retries
  });

  test("rate limiter throttles requests", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const { createRateLimiter } = await import("../../src/core/runner/rate-limiter.ts");
    const limiter = createRateLimiter(10); // 10 req/s → 100ms interval

    const start = Date.now();
    await Promise.all([
      executeRequest({ method: "GET", url: "http://example.com", headers: {} }, { rate_limiter: limiter }),
      executeRequest({ method: "GET", url: "http://example.com", headers: {} }, { rate_limiter: limiter }),
      executeRequest({ method: "GET", url: "http://example.com", headers: {} }, { rate_limiter: limiter }),
    ]);
    const elapsed = Date.now() - start;
    // 3 requests at 10/s means 3rd starts ~200ms after first
    expect(elapsed).toBeGreaterThanOrEqual(180);
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
