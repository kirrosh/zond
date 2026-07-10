import { describe, test, expect, mock, afterEach } from "bun:test";
import { runSuite } from "../../src/core/runner/executor.ts";
import { createSchemaValidator } from "../../src/core/runner/schema-validator.ts";
import type { TestSuite } from "../../src/core/parser/types.ts";
import { DEFAULT_CONFIG } from "../../src/core/parser/schema.ts";
import type { OpenAPIV3 } from "openapi-types";
import { mockFetchSequence as mockFetchResponses, restoreFetch } from "../_helpers/fetch-mock";

const originalFetch = globalThis.fetch;
afterEach(restoreFetch);

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

  test("ARV-427/428: a skipped create leaves the always:true DELETE skipped, not firing on a stale env id", async () => {
    // members-crud shape: create captures member_id, DELETE is always:true.
    // The create is skipped (skip_reason, as --safe sets), and member_id holds a
    // STALE pre-existing value in env (the real owner id). The DELETE must NOT
    // fire against that value.
    const deleteCalls: string[] = [];
    globalThis.fetch = mock(async (_url: unknown, init?: { method?: string }) => {
      if ((init?.method ?? "GET") === "DELETE") deleteCalls.push(String(_url));
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "members-crud",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Create member",
          method: "POST",
          path: "/members",
          skip_reason: "--safe mode: skipped POST write step", // ARV-427
          expect: { status: 201, body: { id: { capture: "member_id" } } },
        },
        {
          name: "Delete member",
          method: "DELETE",
          path: "/members/{{member_id}}",
          always: true,
          expect: { status: 204 },
        },
      ],
    };

    const result = await runSuite(suite, { member_id: "10816603" });
    const createStep = result.steps.find((s) => s.name === "Create member")!;
    const deleteStep = result.steps.find((s) => s.name === "Delete member")!;
    expect(createStep.status).toBe("skip"); // ARV-427: explicit skip, didn't vanish
    expect(createStep.error).toContain("--safe mode");
    expect(deleteStep.status).toBe("skip"); // ARV-428: gated, not executed
    expect(deleteCalls).toEqual([]); // no DELETE against the stale owner id
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

  // ───────────────────────────── TASK-203: branch-gap coverage

  test("per-step timeout abort surfaces step as 'error', does not abort the suite", async () => {
    let callIdx = 0;
    globalThis.fetch = mock((_url, init?: RequestInit) => {
      callIdx++;
      if (callIdx === 1) {
        // Hang the first request — timeout watchdog must trip.
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          }, { once: true });
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "TimeoutSuite",
      config: { ...DEFAULT_CONFIG, timeout: 50, retries: 0 },
      tests: [
        { name: "Slow", method: "GET", path: "http://example.com/slow", expect: { status: 200 } },
        { name: "Fast", method: "GET", path: "http://example.com/fast", expect: { status: 200 } },
      ],
    };

    const result = await runSuite(suite);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.status).toBe("error");
    expect(result.steps[1]!.status).toBe("pass");
  });

  test("for_each iterates over a previously-captured list", async () => {
    mockFetchResponses([
      { status: 200, body: { ids: [1, 2, 3] } },
      { status: 200, body: { id: 1 } },
      { status: 200, body: { id: 2 } },
      { status: 200, body: { id: 3 } },
    ]);

    const suite: TestSuite = {
      name: "ForEachCapturedList",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "list",
          method: "GET",
          path: "/ids",
          expect: { body: { ids: { capture: "ids" } } },
        },
        {
          name: "get",
          method: "GET",
          path: "/items/{{id}}",
          for_each: { var: "id", in: "{{ids}}" },
          expect: { status: 200 },
        },
      ],
    };
    const result = await runSuite(suite);
    // 1 list step + the for_each placeholder + 3 expanded children = 5 steps
    expect(result.steps.length).toBeGreaterThanOrEqual(4);
    const expandedUrls = result.steps
      .map(s => s.request.url)
      .filter(u => u.startsWith("http://example.com/items/"));
    expect(expandedUrls).toEqual([
      "http://example.com/items/1",
      "http://example.com/items/2",
      "http://example.com/items/3",
    ]);
  });

  test("for_each × parameterize: cross-product N×M with isolated per-iteration state", async () => {
    // 2 tiers × 2 items = 4 expanded HTTP calls
    const calls: string[] = [];
    globalThis.fetch = mock(async (url) => {
      calls.push(typeof url === "string" ? url : (url as Request).url);
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Cross",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      parameterize: { tier: ["a", "b"] },
      tests: [{
        name: "T",
        method: "GET",
        path: "/t/{{tier}}/{{item}}",
        for_each: { var: "item", in: [1, 2] },
        expect: { status: 200 },
      }],
    };
    const result = await runSuite(suite);
    expect(calls).toEqual([
      "http://example.com/t/a/1",
      "http://example.com/t/a/2",
      "http://example.com/t/b/1",
      "http://example.com/t/b/2",
    ]);
    // Per-iteration state isolation: each expanded HTTP step recorded a pass.
    const passed = result.steps.filter(s => s.status === "pass" && s.request.url !== "");
    expect(passed.length).toBe(4);
  });

  test("retry_until: body-condition triggers stop; delay_ms>0 actually waits between attempts", async () => {
    let attempt = 0;
    globalThis.fetch = mock(async () => {
      attempt++;
      // Body contains a counter the condition references — proving condition
      // resolves against body, not just HTTP status.
      const body = JSON.stringify({ progress: attempt });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "RetryUntil",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "poll",
        method: "GET",
        path: "/job",
        retry_until: { condition: "{{progress}} >= 2", max_attempts: 4, delay_ms: 30 },
        expect: { status: 200 },
      }],
    };
    const t0 = Date.now();
    const result = await runSuite(suite);
    const elapsed = Date.now() - t0;
    expect(result.steps[0]!.status).toBe("pass");
    expect(attempt).toBe(2);
    // One sleep between attempt 1 and 2 → ≥ ~30ms but < 4× delay
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(200);
  });

  test("multipart with file: '@path' reads fixture and posts a Blob in FormData", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "zond-mp-"));
    const yamlPath = join(dir, "suite.yaml");
    const filePath = join(dir, "payload.bin");
    writeFileSync(filePath, "hello-multipart-bytes");
    writeFileSync(yamlPath, "# placeholder; suite is constructed in-memory");

    let capturedInit: RequestInit | undefined;
    let capturedUrl = "";
    globalThis.fetch = mock(async (url, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : (url as Request).url;
      capturedInit = init;
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "Multipart",
      filePath: yamlPath,
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "upload",
        method: "POST",
        path: "/upload",
        multipart: {
          token: "abc",
          file: { file: "payload.bin", filename: "payload.bin", content_type: "application/octet-stream" },
        },
        expect: { status: 200 },
      }],
    };

    try {
      const result = await runSuite(suite);
      expect(result.steps[0]!.status).toBe("pass");
      expect(capturedUrl).toBe("http://example.com/upload");
      const fd = capturedInit!.body as FormData;
      expect(fd).toBeInstanceOf(FormData);
      expect(fd.get("token")).toBe("abc");
      const filePart = fd.get("file");
      expect(filePart).toBeInstanceOf(Blob);
      const text = await (filePart as Blob).text();
      expect(text).toBe("hello-multipart-bytes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runSuite propagates schemaValidator + networkRetries; provenance merges suite/step", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers as Record<string, string>).entries());
      return new Response(JSON.stringify({ id: "x" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const validateMock = mock(() => []);
    const validator = { validate: validateMock } as unknown as Parameters<typeof runSuite>[3] extends { schemaValidator?: infer V } ? NonNullable<V> : never;

    const suite: TestSuite = {
      name: "Provenance",
      config: DEFAULT_CONFIG,
      source: { type: "openapi-generated", spec: "spec.json", endpoint: "GET /x" },
      tests: [{
        name: "T",
        method: "GET",
        path: "http://example.com/x",
        source: { endpoint: "GET /override", response_branch: "200" },
        expect: { status: 200 },
      }],
    };
    const result = await runSuite(suite, {}, false, {
      schemaValidator: validator,
      networkRetries: 7,
    });
    expect(capturedHeaders).toBeDefined();
    expect(validateMock).toHaveBeenCalledTimes(1);
    const step = result.steps[0]!;
    // step-level overrides suite-level via shallow merge
    expect(step.provenance).toBeDefined();
    expect(step.provenance!.spec).toBe("spec.json");
    expect(step.provenance!.endpoint).toBe("GET /override");
    expect(step.provenance!.response_branch).toBe("200");
    expect(step.provenance!.type).toBe("openapi-generated");
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
    // step.error stores the bare reason; the reporter adds "skipped: " when
    // it renders the line. For a literal-expression skip, the reason IS
    // the expression so callers can tell why it triggered.
    expect(result.steps[0]!.error).toBe("1 == 1");
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

  test("ARV-414: fail-fast (no send, no retry loop) on unresolved request var", async () => {
    // Without the guard this retry_until step would send 20× with 1000ms delays
    // (~20s) polling a resource whose id never resolved. The fix skips it before
    // buildUrl, so the retry loop is never entered and fetch is never called.
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "unresolved-query",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Poll never-seeded id",
        method: "GET",
        path: "/things",
        query: { id: "{{never_seeded_id}}" },
        retry_until: { condition: "status == 404", max_attempts: 20, delay_ms: 1000 },
        expect: { status: 404 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("skip");
    expect(result.steps[0]!.error).toContain("never_seeded_id");
    expect(calls).toBe(0);
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

  // TASK-234 / TASK-237 / ARV-22: skip_if "{{var}} ==" with empty var must
  // produce a friendly reason. The reporter adds "skipped: " when
  // rendering, so step.error is the bare reason — no double "skipped:"
  // prefix in the user-visible line.
  test("skip_if '{{var}} ==' with empty fixture says 'required fixture'", async () => {
    mockFetchResponses([]);
    const suite: TestSuite = {
      name: "Empty fixture",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Get org",
        method: "GET",
        path: "http://example.com/orgs/{{org_id}}/",
        skip_if: "{{org_id}} ==",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite, { org_id: "" });
    expect(result.steps[0]!.status).toBe("skip");
    expect(result.steps[0]!.error).toBe("required fixture {{org_id}} is empty");
    expect(result.steps[0]!.error).not.toContain("skipped:");
    expect(result.steps[0]!.error).not.toContain(" ==");
  });

  test("skip_if '{{var}} ==' with empty chain capture says 'chain capture'", async () => {
    mockFetchResponses([]);
    const suite: TestSuite = {
      name: "Empty chain capture",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Create org",
          method: "POST",
          path: "http://example.com/orgs",
          expect: {
            status: 201,
            body: { id: { capture: "org_id" } },
          },
        },
        {
          name: "Read org",
          method: "GET",
          path: "http://example.com/orgs/{{org_id}}/",
          skip_if: "{{org_id}} ==",
          expect: { status: 200 },
        },
      ],
    };
    // Dry-run: POST does not execute, so org_id never gets captured. The
    // empty-var skip should attribute that to the chain, NOT to fixtures.
    const result = await runSuite(suite, {}, true);
    const readStep = result.steps.find((s) => s.name === "Read org")!;
    expect(readStep.status).toBe("skip");
    expect(readStep.error).toContain("chain capture {{org_id}} unbound");
    expect(readStep.error).not.toContain("required fixture");
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
});

describe("multipart", () => {
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

  // T34 — unknown $generator surfaces as step error, not silent literal
  test("unknown {{$generator}} produces step error with available list", async () => {
    const suite: TestSuite = {
      name: "T34",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Bogus generator",
        method: "GET",
        path: "http://example.com/{{$randomNopeNope}}",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("error");
    expect(result.steps[0]!.error).toMatch(/Unknown generator/);
    expect(result.steps[0]!.error).toMatch(/Available:/);
  });

  test("case-only typo on generator name suggests correct casing", async () => {
    const suite: TestSuite = {
      name: "T34 case",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "Wrong case",
        method: "POST",
        path: "http://example.com/things",
        json: { fqdn: "{{$randomfqdn}}" },
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("error");
    expect(result.steps[0]!.error).toMatch(/did you mean \$randomFqdn/);
  });

  // T44 — granular cascade-skip + always-step
  describe("T44 granular cascade-skip + always-step", () => {
    test("non-always step cascade-skips when prior assertion fails (tainted capture)", async () => {
      mockFetchResponses([
        { status: 201, body: { id: "aud-real-id-123" } }, // status mismatch with expect 200
        { status: 200, body: {} },
      ]);
      const suite: TestSuite = {
        name: "tainted",
        config: DEFAULT_CONFIG,
        tests: [
          {
            name: "Create",
            method: "POST",
            path: "http://example.com/audiences",
            expect: {
              status: 200, // wrong: API returns 201 → tainted
              body: { id: { capture: "audience_id" } },
            },
          },
          {
            name: "Read",
            method: "GET",
            path: "http://example.com/audiences/{{audience_id}}",
            expect: { status: 200 },
          },
        ],
      };
      const result = await runSuite(suite);
      expect(result.steps[0]!.status).toBe("fail");
      expect(result.steps[1]!.status).toBe("skip");
      expect(result.steps[1]!.error).toMatch(/tainted capture: audience_id/);
    });

    test("always:true step runs on tainted capture (cleanup still fires)", async () => {
      mockFetchResponses([
        { status: 201, body: { id: "aud-real-id-123" } }, // tainted: status mismatch
        { status: 200, body: {} }, // DELETE succeeds
      ]);
      const suite: TestSuite = {
        name: "always-cleanup",
        config: DEFAULT_CONFIG,
        tests: [
          {
            name: "Create",
            method: "POST",
            path: "http://example.com/audiences",
            expect: {
              status: 200,
              body: { id: { capture: "audience_id" } },
            },
          },
          {
            name: "Cleanup",
            method: "DELETE",
            path: "http://example.com/audiences/{{audience_id}}",
            always: true,
            expect: { status: 200 },
          },
        ],
      };
      const result = await runSuite(suite);
      expect(result.steps[0]!.status).toBe("fail");
      expect(result.steps[1]!.status).toBe("pass");
    });

    test("always:true step still skips when capture is genuinely missing", async () => {
      mockFetchResponses([
        { status: 500, body: {} }, // no id field at all
        { status: 200, body: {} },
      ]);
      const suite: TestSuite = {
        name: "always-missing",
        config: DEFAULT_CONFIG,
        tests: [
          {
            name: "Create",
            method: "POST",
            path: "http://example.com/audiences",
            expect: {
              status: 201,
              body: { id: { capture: "audience_id" } },
            },
          },
          {
            name: "Cleanup",
            method: "DELETE",
            path: "http://example.com/audiences/{{audience_id}}",
            always: true,
            expect: { status: 200 },
          },
        ],
      };
      const result = await runSuite(suite);
      expect(result.steps[0]!.status).toBe("fail");
      expect(result.steps[1]!.status).toBe("skip");
      expect(result.steps[1]!.error).toMatch(/missing capture: audience_id/);
      expect(result.steps[1]!.failure_class).toBe("cascade");
    });

    test("always:true respects skip_if (explicit user skip still fires)", async () => {
      const suite: TestSuite = {
        name: "always-skip_if",
        config: DEFAULT_CONFIG,
        tests: [
          {
            name: "Cleanup",
            method: "DELETE",
            path: "http://example.com/x/123",
            always: true,
            skip_if: "true",
            expect: { status: 200 },
          },
        ],
      };
      const result = await runSuite(suite);
      expect(result.steps[0]!.status).toBe("skip");
    });
  });

  test("dependent step skips cleanly when {{$generator}} fails on prior step", async () => {
    const suite: TestSuite = {
      name: "T34 cascade",
      config: DEFAULT_CONFIG,
      tests: [
        {
          name: "Create",
          method: "POST",
          path: "http://example.com/things",
          json: { name: "{{$randomNotARealHelper}}" },
          expect: {
            status: 200,
            body: { id: { capture: "thing_id" } },
          },
        },
        {
          name: "Use captured",
          method: "GET",
          path: "http://example.com/things/{{thing_id}}",
          expect: { status: 200 },
        },
      ],
    };

    const result = await runSuite(suite);
    expect(result.steps[0]!.status).toBe("error");
    expect(result.steps[1]!.status).toBe("skip");
    expect(result.steps[1]!.error).toMatch(/missing capture: thing_id/);
    expect(result.steps[1]!.failure_class).toBe("cascade");
    expect(result.steps[1]!.failure_class_reason).toMatch(/Upstream capture not produced: thing_id/);
  });
});

describe("schema validation integration", () => {
  test("schemaValidator failures land in step.assertions and fail the step", async () => {
    mockFetchResponses([{ status: 200, body: { data: [] } }]); // missing has_more

    const doc: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/emails": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["data", "has_more"],
                      properties: {
                        data: { type: "array", items: {} },
                        has_more: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const suite: TestSuite = {
      name: "Resend B11",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [{
        name: "List emails",
        method: "GET",
        path: "/emails",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite, {}, false, { schemaValidator: createSchemaValidator(doc) });
    expect(result.failed).toBe(1);
    const failed = result.steps[0]!.assertions.filter(a => !a.passed);
    expect(failed.some(a => a.rule === "schema.required")).toBe(true);
  });

  test("step passes when --validate-schema agrees", async () => {
    mockFetchResponses([{ status: 200, body: { data: [], has_more: false } }]);

    const doc: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/emails": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["data", "has_more"],
                      properties: { data: { type: "array", items: {} }, has_more: { type: "boolean" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const suite: TestSuite = {
      name: "ok",
      base_url: "http://example.com",
      config: DEFAULT_CONFIG,
      tests: [{ name: "List", method: "GET", path: "/emails", expect: { status: 200 } }],
    };

    const result = await runSuite(suite, {}, false, { schemaValidator: createSchemaValidator(doc) });
    expect(result.passed).toBe(1);
  });
});
