import { describe, test, expect } from "bun:test";
import { serializeSuite } from "../../src/core/generator/serializer.ts";
import type { RawSuite } from "../../src/core/generator/serializer.ts";
import { validateSuite } from "../../src/core/parser/schema.ts";

describe("serializeSuite", () => {
  test("nested object in json body does not produce [object Object]", () => {
    const suite: RawSuite = {
      name: "test-suite",
      tests: [
        {
          name: "create item",
          POST: "/items",
          json: {
            name: "test",
            address: { city: "New York", zip: "10001" },
          },
          expect: { status: 201 },
        },
      ],
    };

    const yaml = serializeSuite(suite);
    expect(yaml).not.toContain("[object Object]");
    expect(yaml).toContain("city:");
    expect(yaml).toContain("New York");
    expect(yaml).toContain("zip:");
    expect(yaml).toContain("10001");
  });

  test("array of objects with nested fields does not produce [object Object]", () => {
    const suite: RawSuite = {
      name: "test-suite",
      tests: [
        {
          name: "create with sites",
          POST: "/cases",
          json: {
            sites: [
              { id: 1, address: { city: "NY", country: "US" } },
            ],
          },
          expect: { status: 201 },
        },
      ],
    };

    const yaml = serializeSuite(suite);
    expect(yaml).not.toContain("[object Object]");
    expect(yaml).toContain("city:");
    expect(yaml).toContain("NY");
    expect(yaml).toContain("country:");
  });

  test("setup: true appears in YAML output after name", () => {
    const suite: RawSuite = {
      name: "auth",
      setup: true,
      tags: ["auth"],
      tests: [
        { name: "login", POST: "/auth/login", json: {}, expect: { status: 200 } },
      ],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).toContain("setup: true");
    // setup should appear before tags
    expect(yaml.indexOf("setup: true")).toBeLessThan(yaml.indexOf("tags:"));
  });

  test("setup omitted when false/undefined", () => {
    const suite: RawSuite = {
      name: "users",
      tests: [{ name: "list", GET: "/users", expect: { status: 200 } }],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).not.toContain("setup:");
  });

  test("setup: true round-trips through parser", () => {
    const suite: RawSuite = {
      name: "auth",
      setup: true,
      tests: [{ name: "login", POST: "/auth/login", json: {}, expect: { status: 200 } }],
    };
    const yaml = serializeSuite(suite);
    const parsed = validateSuite(Bun.YAML.parse(yaml));
    expect(parsed.setup).toBe(true);
  });

  test("array of primitive strings serializes correctly", () => {
    const suite: RawSuite = {
      name: "test-suite",
      tests: [
        {
          name: "create",
          POST: "/items",
          json: { tags: ["a", "b", "c"] },
          expect: { status: 201 },
        },
      ],
    };

    const yaml = serializeSuite(suite);
    expect(yaml).toContain("- a");
    expect(yaml).toContain("- b");
  });

  test("status as array serializes inline (T27 negative smoke)", () => {
    const suite: RawSuite = {
      name: "neg",
      tests: [
        {
          name: "missing resource",
          GET: "/users/00000000-0000-0000-0000-000000000000",
          expect: { status: [400, 404, 422] },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).toContain("status: [400, 404, 422]");
    // Round-trip: parser should accept it as a valid suite
    const parsed = validateSuite(yamlToObject(yaml));
    expect(parsed.tests[0]!.expect.status).toEqual([400, 404, 422]);
  });

  test("skip_if is serialized at step level (T27 positive smoke)", () => {
    const suite: RawSuite = {
      name: "pos",
      tests: [
        {
          name: "read by id",
          GET: "/users/{{user_id}}",
          skip_if: "{{user_id}} ==",
          expect: { status: 200 },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).toContain('skip_if: "{{user_id}} =="');
  });
});

function yamlToObject(yaml: string): unknown {
  return Bun.YAML.parse(yaml);
}
