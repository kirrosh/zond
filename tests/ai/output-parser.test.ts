import { describe, test, expect } from "bun:test";
import { parseAIResponse } from "../../src/core/generator/ai/output-parser.ts";

describe("output-parser", () => {
  test("parses clean JSON with suites array", () => {
    const raw = JSON.stringify({
      suites: [
        {
          name: "Pet CRUD",
          tests: [
            {
              name: "Create pet",
              POST: "/pets",
              json: { name: "Buddy", species: "dog" },
              expect: { status: 201, body: { id: { type: "number", capture: "pet_id" } } },
            },
            {
              name: "Get pet",
              GET: "/pets/{{pet_id}}",
              expect: { status: 200, body: { name: { type: "string" } } },
            },
          ],
        },
      ],
    });

    const result = parseAIResponse(raw);
    expect(result.suites.length).toBe(1);
    expect(result.suites[0]!.name).toBe("Pet CRUD");
    expect(result.suites[0]!.tests.length).toBe(2);
    expect(result.yaml).toContain("name: Pet CRUD");
    expect(result.yaml).toContain("POST: /pets");
    expect(result.yaml).toContain("GET: /pets/{{pet_id}}");
  });

  test("parses JSON wrapped in ```json fences", () => {
    const raw = '```json\n{"suites":[{"name":"Test","tests":[{"name":"Get","GET":"/api","expect":{"status":200}}]}]}\n```';
    const result = parseAIResponse(raw);
    expect(result.suites.length).toBe(1);
    expect(result.yaml).toContain("GET: /api");
  });

  test("parses JSON wrapped in ``` fences (no json tag)", () => {
    const raw = '```\n{"suites":[{"name":"Test","tests":[{"name":"Get","GET":"/api","expect":{"status":200}}]}]}\n```';
    const result = parseAIResponse(raw);
    expect(result.suites.length).toBe(1);
  });

  test("parses JSON with leading text", () => {
    const raw = 'Here is the generated test suite:\n\n{"suites":[{"name":"Test","tests":[{"name":"Get","GET":"/api","expect":{"status":200}}]}]}';
    const result = parseAIResponse(raw);
    expect(result.suites.length).toBe(1);
  });

  test("parses single suite object (not wrapped in suites array)", () => {
    const raw = JSON.stringify({
      name: "Single Suite",
      tests: [
        { name: "Get", GET: "/api", expect: { status: 200 } },
      ],
    });
    const result = parseAIResponse(raw);
    expect(result.suites.length).toBe(1);
    expect(result.suites[0]!.name).toBe("Single Suite");
  });

  test("returns error for invalid JSON", () => {
    const raw = "This is not JSON at all, just plain text response.";
    const result = parseAIResponse(raw);
    expect(result.suites.length).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("skips suites without tests but includes valid ones", () => {
    const raw = JSON.stringify({
      suites: [
        { name: "Empty", base_url: "http://localhost" },
        {
          name: "Valid",
          tests: [{ name: "Get", GET: "/api", expect: { status: 200 } }],
        },
      ],
    });
    const result = parseAIResponse(raw);
    // The empty suite is skipped, only the valid one is included
    expect(result.suites.length).toBe(1);
    expect(result.suites[0]!.name).toBe("Valid");
    expect(result.errors.length).toBeGreaterThan(0); // skip message for empty suite
  });

  test("generates valid YAML with captures", () => {
    const raw = JSON.stringify({
      suites: [
        {
          name: "Chain Test",
          base_url: "{{base_url}}",
          tests: [
            {
              name: "Create",
              POST: "/items",
              json: { name: "test" },
              expect: {
                status: 201,
                body: { id: { type: "number", capture: "item_id" } },
              },
            },
            {
              name: "Verify",
              GET: "/items/{{item_id}}",
              expect: { status: 200 },
            },
          ],
        },
      ],
    });
    const result = parseAIResponse(raw);
    expect(result.yaml).toContain("capture:");
    expect(result.yaml).toContain("{{item_id}}");
  });

  test("handles array of suites at top level", () => {
    const raw = JSON.stringify([
      {
        name: "Suite A",
        tests: [{ name: "Get", GET: "/a", expect: { status: 200 } }],
      },
    ]);
    const result = parseAIResponse(raw);
    expect(result.suites.length).toBe(1);
    expect(result.suites[0]!.name).toBe("Suite A");
  });
});
