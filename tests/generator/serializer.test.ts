import { describe, test, expect } from "bun:test";
import { serializeSuite } from "../../src/core/generator/serializer.ts";
import type { RawSuite } from "../../src/core/generator/serializer.ts";

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
});
