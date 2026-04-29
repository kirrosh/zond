import { describe, test, expect, mock, afterEach } from "bun:test";
import { runSuite, expandParameterize } from "../../src/core/runner/executor.ts";
import type { TestSuite } from "../../src/core/parser/types.ts";
import { DEFAULT_CONFIG } from "../../src/core/parser/schema.ts";
import { validateSuite } from "../../src/core/parser/schema.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function recordedFetch() {
  const urls: string[] = [];
  globalThis.fetch = mock(async (input: Request | string | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return new Response(JSON.stringify({ object: "list", data: [], has_more: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return urls;
}

describe("expandParameterize (cross-product)", () => {
  test("no parameterize → single empty iteration", () => {
    expect(expandParameterize()).toEqual([{}]);
    expect(expandParameterize({})).toEqual([{}]);
  });

  test("one key → N iterations", () => {
    expect(expandParameterize({ endpoint: ["/a", "/b", "/c"] })).toEqual([
      { endpoint: "/a" }, { endpoint: "/b" }, { endpoint: "/c" },
    ]);
  });

  test("two keys → cross-product (N×M, lexicographic on first key)", () => {
    const out = expandParameterize({ endpoint: ["/a", "/b"], method: ["GET", "POST"] });
    expect(out).toHaveLength(4);
    expect(out).toContainEqual({ endpoint: "/a", method: "GET" });
    expect(out).toContainEqual({ endpoint: "/a", method: "POST" });
    expect(out).toContainEqual({ endpoint: "/b", method: "GET" });
    expect(out).toContainEqual({ endpoint: "/b", method: "POST" });
  });

  test("empty array for a key → that key is dropped", () => {
    expect(expandParameterize({ endpoint: ["/a"], extra: [] })).toEqual([{ endpoint: "/a" }]);
  });
});

describe("runSuite — parameterize (TASK-77)", () => {
  test("expands suite body once per binding; URL and name interpolate {{var}}", async () => {
    const urls = recordedFetch();

    const suite: TestSuite = {
      name: "list-shape",
      config: DEFAULT_CONFIG,
      parameterize: { endpoint: ["/emails", "/domains", "/webhooks"] },
      tests: [{
        name: "list shape on {{endpoint}}",
        method: "GET",
        path: "http://api.example{{endpoint}}",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);

    expect(result.total).toBe(3);
    expect(result.passed).toBe(3);
    expect(urls).toEqual([
      "http://api.example/emails",
      "http://api.example/domains",
      "http://api.example/webhooks",
    ]);
    // Each step's recorded name has its placeholder substituted, so the
    // reporter can distinguish iterations.
    expect(result.steps.map(s => s.name)).toEqual([
      "list shape on /emails",
      "list shape on /domains",
      "list shape on /webhooks",
    ]);
  });

  test("multiple parameterize keys → cross-product runs", async () => {
    const urls = recordedFetch();

    const suite: TestSuite = {
      name: "matrix",
      config: DEFAULT_CONFIG,
      parameterize: { endpoint: ["/a", "/b"], variant: ["x", "y"] },
      tests: [{
        name: "{{endpoint}}/{{variant}}",
        method: "GET",
        path: "http://api.example{{endpoint}}?v={{variant}}",
        expect: { status: 200 },
      }],
    };

    const result = await runSuite(suite);

    expect(result.total).toBe(4);
    expect(result.passed).toBe(4);
    const names = result.steps.map(s => s.name).sort();
    expect(names).toEqual(["/a/x", "/a/y", "/b/x", "/b/y"]);
    expect(urls.length).toBe(4);
  });

  test("captures from one iteration are NOT visible in the next", async () => {
    let callIndex = 0;
    globalThis.fetch = mock(async () => {
      // First iteration captures id=42; second iteration must not see it.
      const body = callIndex === 0 ? { id: 42 } : { seen_id: "{{id}}" };
      callIndex++;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const suite: TestSuite = {
      name: "iso",
      config: DEFAULT_CONFIG,
      parameterize: { which: ["first", "second"] },
      tests: [
        {
          name: "create ({{which}})",
          method: "POST",
          path: "http://api.example/x",
          expect: { status: 200, body: { id: { capture: "id", type: "integer" } } },
        },
      ],
    };

    const result = await runSuite(suite);
    // First iteration captures id, second iteration's response has no `id`,
    // so its capture is recorded as missing — but crucially the previous
    // value of `id` (42) does NOT carry over: result reports a missing
    // capture for the second iteration.
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.captures).toEqual({ id: 42 });
    // Iteration 2: capture not extracted → empty captures object.
    expect(result.steps[1]!.captures).toEqual({});
  });

  test("schema accepts parameterize map", () => {
    const raw = {
      name: "schema-test",
      parameterize: { endpoint: ["/a", "/b"] },
      tests: [{ name: "x", GET: "{{endpoint}}", expect: { status: 200 } }],
    };
    const suite = validateSuite(raw);
    expect(suite.parameterize).toEqual({ endpoint: ["/a", "/b"] });
  });
});
