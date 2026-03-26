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

describe("flow control", () => {
  test("skip_if skips step when condition is true", async () => {
    mockFetchResponses([{ status: 200, body: { ok: true } }]);

    const suite: TestSuite = {
      name: "Skip test",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Conditional",
          method: "GET",
          path: "http://example.com/test",
          skip_if: "1 == 1",
          expect: { status: 200 },
        },
        {
          name: "Always runs",
          method: "GET",
          path: "http://example.com/test",
          expect: { status: 200 },
        },
      ],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("skip");
    expect(result.steps[0]!.error).toContain("Skipped");
    expect(result.steps[1]!.status).toBe("pass");
  });

  test("skip_if does NOT skip when condition is false", async () => {
    mockFetchResponses([{ status: 200, body: { ok: true } }]);

    const suite: TestSuite = {
      name: "No skip",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Runs",
        method: "GET",
        path: "http://example.com/test",
        skip_if: "1 == 0",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("pass");
  });

  test("skip_if with variable substitution", async () => {
    mockFetchResponses([]);

    const suite: TestSuite = {
      name: "Skip with var",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Conditional",
        method: "GET",
        path: "http://example.com/test",
        skip_if: "{{should_skip}} == true",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite, { should_skip: "true" });
    expect(result.steps[0]!.status).toBe("skip");
  });

  test("set step writes variables without HTTP request", async () => {
    mockFetchResponses([{ status: 200, body: { ok: true } }]);

    const suite: TestSuite = {
      name: "Set test",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Set vars",
          method: "GET" as const,
          path: "",
          set: { greeting: "hello", count: 42 },
          expect: {},
        },
        {
          name: "Use vars",
          method: "GET",
          path: "http://example.com/{{greeting}}",
          expect: { status: 200 },
        },
      ],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("pass");
    expect(result.steps[0]!.request.method).toBe("");
    expect(result.steps[1]!.request.url).toBe("http://example.com/hello");
  });

  test("set step with transform directives", async () => {
    mockFetchResponses([{ status: 200, body: { ok: true } }]);

    const suite: TestSuite = {
      name: "Transform test",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Transform",
          method: "GET" as const,
          path: "",
          set: {
            ids: { map_field: ["{{items}}", "id"] },
          },
          expect: {},
        },
      ],
    };

    const items = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
    const result = await runSuite(suite, { items: JSON.stringify(items) } as Record<string, string>);
    expect(result.steps[0]!.status).toBe("pass");
  });

  test("set: on HTTP step evaluates generators once before request", async () => {
    const requestBodies: unknown[] = [];
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) requestBodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Set on HTTP test",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Register",
          method: "POST",
          path: "http://example.com/register",
          set: { test_email: "test_{{$uuid}}@example.com" },
          json: { email: "{{test_email}}" },
          expect: { status: 201 },
        },
        {
          name: "Login",
          method: "POST",
          path: "http://example.com/login",
          json: { email: "{{test_email}}" },
          expect: { status: 201 },
        },
      ],
    };

    await runSuite(suite);
    expect(requestBodies).toHaveLength(2);
    const registerEmail = (requestBodies[0] as Record<string, string>).email;
    const loginEmail = (requestBodies[1] as Record<string, string>).email;
    // Both steps must use the same email (UUID pinned on set:)
    expect(registerEmail).toBe(loginEmail);
    expect(registerEmail).toMatch(/^test_[0-9a-f-]+@example\.com$/);
  });

  test("for_each expands steps for each item", async () => {
    let urls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      urls.push(typeof url === "string" ? url : (url as Request).url);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "ForEach test",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Delete item",
        method: "DELETE",
        path: "/items/{{id}}",
        for_each: { var: "id", in: [1, 2, 3] },
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    // Original for_each step is not executed, 3 expanded steps are
    expect(result.total).toBe(3);
    expect(result.passed).toBe(3);
    expect(urls).toEqual([
      "http://example.com/items/1",
      "http://example.com/items/2",
      "http://example.com/items/3",
    ]);
  });

  test("retry_until retries until condition met", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      const status = callCount >= 3 ? "completed" : "pending";
      return new Response(JSON.stringify({ status }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Retry test",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Wait for completion",
        method: "GET",
        path: "http://example.com/job/1",
        retry_until: { condition: "{{status}} == completed", max_attempts: 5, delay_ms: 0 },
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("pass");
    expect(callCount).toBe(3);
  });

  test("retry_until stops after max_attempts", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response(JSON.stringify({ status: "pending" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Retry max",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Never completes",
        method: "GET",
        path: "http://example.com/job/1",
        retry_until: { condition: "{{status}} == completed", max_attempts: 3, delay_ms: 0 },
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(callCount).toBe(3);
    expect(result.total).toBe(1);
  });
});

describe("URL validation", () => {
  test("relative URL (no base_url) produces error with actionable message", async () => {
    const suite: TestSuite = {
      name: "No base_url",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Get users",
        method: "GET",
        path: "/users",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite); // no env, no base_url
    expect(result.total).toBe(1);
    expect(result.steps[0]!.status).toBe("error");
    expect(result.steps[0]!.error).toContain("base_url is not configured");
    expect(result.steps[0]!.error).toContain("/users");
    expect(result.steps[0]!.error).toContain(".env.yaml");
    // fetch must NOT have been called
    expect(globalThis.fetch).toBe(originalFetch); // original fetch, not a mock
  });

  test("empty base_url substituted from env produces error with actionable message", async () => {
    const suite: TestSuite = {
      name: "Empty base_url",
      base_url: "{{base_url}}",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Get items",
        method: "GET",
        path: "/items",
        expect: { status: 200 },
      }],
    };

    // env has base_url = "" (empty string — falsy)
    const result = await runSuite(suite, { base_url: "" });
    expect(result.steps[0]!.status).toBe("error");
    expect(result.steps[0]!.error).toContain("base_url is not configured");
  });

  test("absolute URL works normally", async () => {
    mockFetchResponses([{ status: 200, body: { ok: true } }]);

    const suite: TestSuite = {
      name: "Has base_url",
      base_url: "https://api.example.com",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Get",
        method: "GET",
        path: "/users",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("pass");
    expect(result.steps[0]!.request.url).toBe("https://api.example.com/users");
  });

  test("subsequent steps skip when prior step with capture had bad URL", async () => {
    const suite: TestSuite = {
      name: "Cascade skip",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Create",
          method: "POST",
          path: "/items",         // relative — will error
          json: { name: "foo" },
          expect: { status: 201, body: { id: { capture: "item_id" } } },
        },
        {
          name: "Get",
          method: "GET",
          path: "/items/{{item_id}}",
          expect: { status: 200 },
        },
      ],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("error");
    expect(result.steps[1]!.status).toBe("skip");
    expect(result.steps[1]!.error).toContain("item_id");
  });
});

describe("setup suite propagation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("captures from setup suite propagate to regular suite via env merge", async () => {
    // Simulate the propagation pattern used in execute-run.ts and run.ts:
    //   setupCaptures collected from setup suite results
    //   regular suite receives { ...env, ...setupCaptures }
    mockFetchResponses([
      { status: 200, body: { token: "setup-token-xyz" } },  // setup: login
      { status: 200, body: { data: "ok" } },                 // regular: protected endpoint
    ]);

    const setupSuite: TestSuite = {
      name: "setup",
      setup: true,
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Login",
        method: "POST",
        path: "http://example.com/auth/login",
        json: { username: "admin", password: "pass" },
        expect: {
          status: 200,
          body: { token: { capture: "auth_token" } },
        },
      }],
    };

    const regularSuite: TestSuite = {
      name: "api-tests",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Get data",
        method: "GET",
        path: "http://example.com/data",
        headers: { Authorization: "Bearer {{auth_token}}" },
        expect: { status: 200 },
      }],
    };

    // Run setup suite, collect captures
    const setupResult = await runSuite(setupSuite, {});
    expect(setupResult.steps[0]!.status).toBe("pass");

    const setupCaptures: Record<string, string> = {};
    for (const step of setupResult.steps) {
      for (const [k, v] of Object.entries(step.captures)) {
        setupCaptures[k] = String(v);
      }
    }
    expect(setupCaptures["auth_token"]).toBe("setup-token-xyz");

    // Run regular suite with setupCaptures merged in (overrides stale env value)
    const staleEnv = { auth_token: "old-stale-token" };
    const enrichedEnv = { ...staleEnv, ...setupCaptures };
    const regularResult = await runSuite(regularSuite, enrichedEnv);
    expect(regularResult.steps[0]!.status).toBe("pass");

    // Verify the request used the fresh token, not the stale one
    const sentHeader = regularResult.steps[0]!.request.headers["Authorization"];
    expect(sentHeader).toBe("Bearer setup-token-xyz");
  });

  test("sends multipart/form-data with text fields", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Multipart",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Upload text fields",
        method: "POST",
        path: "http://example.com/files",
        multipart: {
          description: "Hello world",
          tag: "test",
        },
        expect: { status: 201 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("pass");
    expect(capturedInit?.body).toBeInstanceOf(FormData);
    const fd = capturedInit!.body as FormData;
    expect(fd.get("description")).toBe("Hello world");
    expect(fd.get("tag")).toBe("test");
  });
});

describe("header captures", () => {
  test("captures value from response header via AssertionRule", async () => {
    mockFetchResponses([
      { status: 200, body: { id: 1 }, headers: { "ETag": '"abc123"' } },
      { status: 200, body: { id: 1 } },
    ]);

    const suite: TestSuite = {
      name: "ETag capture",
      config: DEFAULT_CONFIG,
      base_url: "http://example.com",
      tests: [
        {
          name: "Get item with ETag",
          method: "GET",
          path: "http://example.com/items/1",
          expect: {
            status: 200,
            headers: { ETag: { capture: "item_etag" } },
          },
        },
        {
          name: "Use captured ETag",
          method: "PUT",
          path: "http://example.com/items/1",
          headers: { "If-Match": "{{item_etag}}" },
          expect: { status: 200 },
        },
      ],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.captures).toMatchObject({ item_etag: '"abc123"' });
    expect(result.steps[1]!.status).toBe("pass");
  });
});
