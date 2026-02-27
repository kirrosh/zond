import { describe, test, expect, mock, afterEach } from "bun:test";
import { runSuite, runSuites } from "../../src/core/runner/executor.ts";
import type { TestSuite } from "../../src/core/parser/types.ts";
import { DEFAULT_CONFIG } from "../../src/core/parser/schema.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

describe("runSuite", () => {
  test("runs single passing step", async () => {
    mockFetchResponses([{ status: 200, body: { ok: true } }]);

    const suite: TestSuite = {
      name: "Simple",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Health",
        method: "GET",
        path: "http://example.com/health",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.suite_name).toBe("Simple");
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.steps[0]!.status).toBe("pass");
  });

  test("runs single failing step", async () => {
    mockFetchResponses([{ status: 500, body: { error: "internal" } }]);

    const suite: TestSuite = {
      name: "Fail",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Bad",
        method: "GET",
        path: "http://example.com/fail",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.steps[0]!.status).toBe("fail");
  });

  test("captures values and passes to subsequent steps", async () => {
    mockFetchResponses([
      { status: 201, body: { id: 42, name: "John" } },
      { status: 200, body: { id: 42, name: "John" } },
    ]);

    const suite: TestSuite = {
      name: "Capture chain",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Create",
          method: "POST",
          path: "/users",
          json: { name: "John" },
          expect: {
            status: 201,
            body: { id: { capture: "user_id", type: "integer" } },
          },
        },
        {
          name: "Get",
          method: "GET",
          path: "/users/{{user_id}}",
          expect: {
            status: 200,
            body: { id: { equals: "{{user_id}}" } },
          },
        },
      ],
    };

    const result = await runSuite(suite);
    expect(result.passed).toBe(2);
    expect(result.steps[0]!.captures).toEqual({ user_id: 42 });

    // Verify the second request used the captured value
    expect(result.steps[1]!.request.url).toBe("http://example.com/users/42");
  });

  test("skips steps that depend on failed captures", async () => {
    mockFetchResponses([
      { status: 500, body: {} }, // Create fails, capture not obtained
    ]);

    const suite: TestSuite = {
      name: "Skip test",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Create",
          method: "POST",
          path: "/users",
          expect: {
            status: 201,
            body: { id: { capture: "user_id", type: "integer" } },
          },
        },
        {
          name: "Get (depends on user_id)",
          method: "GET",
          path: "/users/{{user_id}}",
          expect: { status: 200 },
        },
        {
          name: "List (no dependency)",
          method: "GET",
          path: "/users",
          expect: { status: 200 },
        },
      ],
    };

    // Need a third response for the "List" step
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) return new Response(JSON.stringify({}), { status: 500, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await runSuite(suite);
    expect(result.total).toBe(3);
    expect(result.failed).toBe(1);  // Create fails
    expect(result.skipped).toBe(1); // Get skipped
    expect(result.passed).toBe(1);  // List passes
    expect(result.steps[1]!.status).toBe("skip");
    expect(result.steps[1]!.error).toContain("user_id");
  });

  test("merges suite-level headers with step headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers as Record<string, string>).entries());
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Headers",
      headers: { Authorization: "Bearer suite-token", "X-Suite": "yes" },
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Step",
        method: "GET",
        path: "http://example.com/test",
        headers: { "X-Step": "yes", Authorization: "Bearer step-token" },
        expect: {},
      }],
    };

    await runSuite(suite);
    expect(capturedHeaders["authorization"]).toBe("Bearer step-token"); // step overrides suite
    expect(capturedHeaders["x-suite"]).toBe("yes"); // suite header preserved
    expect(capturedHeaders["x-step"]).toBe("yes"); // step header added
  });

  test("substitutes environment variables", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : (url as Request).url;
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Env test",
      base_url: "{{base}}",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Health",
        method: "GET",
        path: "/health",
        expect: { status: 200 },
      }],
    };

    await runSuite(suite, { base: "http://api.example.com" });
    expect(capturedUrl).toBe("http://api.example.com/health");
  });

  test("auto-sets Content-Type for JSON body", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers as Record<string, string>).entries());
      return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "JSON",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Create",
        method: "POST",
        path: "http://example.com/users",
        json: { name: "John" },
        expect: { status: 201 },
      }],
    };

    await runSuite(suite);
    expect(capturedHeaders["content-type"]).toBe("application/json");
  });

  test("handles fetch error with error status", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Error",
      config: { ...DEFAULT_CONFIG, retries: 0 },
      tests: [{
        name: "Fail",
        method: "GET",
        path: "http://example.com/fail",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("error");
    expect(result.steps[0]!.error).toContain("Connection refused");
  });

  test("builds URL with query params", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : (url as Request).url;
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Query",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "List",
        method: "GET",
        path: "/users",
        query: { page: "1", limit: "10" },
        expect: {},
      }],
    };

    await runSuite(suite);
    expect(capturedUrl).toContain("page=1");
    expect(capturedUrl).toContain("limit=10");
  });

  test("provides timestamps in result", async () => {
    mockFetchResponses([{ status: 200, body: {} }]);

    const suite: TestSuite = {
      name: "Timestamps",
      config: DEFAULT_CONFIG,
      tests: [{ name: "T", method: "GET", path: "http://x.com/t", expect: {} }],
    };

    const result = await runSuite(suite);
    expect(result.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("runSuites", () => {
  test("runs multiple suites in parallel", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response(JSON.stringify({ n: callCount }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suites: TestSuite[] = [
      { name: "A", config: DEFAULT_CONFIG, tests: [{ name: "A1", method: "GET", path: "http://x.com/a", expect: { status: 200 } }] },
      { name: "B", config: DEFAULT_CONFIG, tests: [{ name: "B1", method: "GET", path: "http://x.com/b", expect: { status: 200 } }] },
    ];

    const results = await runSuites(suites);
    expect(results).toHaveLength(2);
    expect(results[0]!.suite_name).toBe("A");
    expect(results[1]!.suite_name).toBe("B");
    expect(callCount).toBe(2);
  });
});
