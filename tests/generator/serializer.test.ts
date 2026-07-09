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

  test("ARV-390 — OPTIONS/HEAD/TRACE method keys survive serialization (round-trip valid)", () => {
    const suite: RawSuite = {
      name: "probe methods /pets",
      tests: [
        { name: "options", OPTIONS: "/pets", expect: { status: [200, 204, 405] } },
        { name: "head", HEAD: "/pets", expect: { status: [200, 405] } },
        { name: "trace", TRACE: "/pets", expect: { status: [405] } },
      ],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).toContain("OPTIONS: /pets");
    expect(yaml).toContain("HEAD: /pets");
    expect(yaml).toContain("TRACE: /pets");
    // Round-trip: the runner must accept what the generator emits.
    expect(() => validateSuite(yamlToObject(yaml))).not.toThrow();
  });

  test("ARV-390 — empty json body emits inline `json: {}` not bare `json:` (null)", () => {
    const suite: RawSuite = {
      name: "probe",
      tests: [{ name: "put", PUT: "/pets", json: {}, expect: { status: [405] } }],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).toContain("json: {}");
    const parsed = yamlToObject(yaml) as { tests: Array<{ json: unknown }> };
    expect(parsed.tests[0]!.json).toEqual({});
  });

  test("TASK-221 / F13 — empty {} value emits inline `{}` not bare key (which YAML re-parses as null)", () => {
    const suite: RawSuite = {
      name: "test-suite",
      tests: [
        {
          name: "create automation",
          POST: "/automations",
          json: { steps: [{ kind: "wait", config: {} }] },
          expect: { status: 201 },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).toContain("config: {}");
    const parsed = yamlToObject(yaml) as { tests: { json: { steps: { config: unknown }[] } }[] };
    expect(parsed.tests[0]!.json.steps[0]!.config).toEqual({});
  });

  test("TASK-221 / F13 — empty [] value emits inline `[]` not bare key", () => {
    const suite: RawSuite = {
      name: "test-suite",
      tests: [
        {
          name: "create",
          POST: "/x",
          json: { tags: [] },
          expect: { status: 201 },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).toContain("tags: []");
    const parsed = yamlToObject(yaml) as { tests: { json: { tags: unknown } }[] };
    expect(parsed.tests[0]!.json.tags).toEqual([]);
  });
  test("ARV-62 / F3 — raw CRLF in string payload emits valid YAML round-trip (escaped \\r\\n)", () => {
    const crlfPayload = "zond-safe\r\nX-Zond-Injected: yes";
    const suite: RawSuite = {
      name: "probe-security",
      tests: [
        {
          name: `crlf: name=${crlfPayload} must not echo`,
          POST: "/items",
          json: { name: crlfPayload },
          expect: { status: [400, 422] },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).not.toContain("zond-safe\r\nX-Zond-Injected");
    expect(yaml).toContain("\\r\\nX-Zond-Injected");
    const parsed = yamlToObject(yaml) as {
      tests: { name: string; json: { name: string } }[];
    };
    expect(parsed.tests[0]!.json.name).toBe(crlfPayload);
    expect(parsed.tests[0]!.name).toContain(crlfPayload);
  });

  test("ARV-62 / F3 — tab and other control bytes are escaped, not emitted raw", () => {
    const suite: RawSuite = {
      name: "probe-security",
      tests: [
        {
          name: "ctrl",
          POST: "/x",
          json: { payload: "before\tafter\x00null\x7fdel" },
          expect: { status: 400 },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    expect(yaml).toContain("\\t");
    expect(yaml).toContain("\\x00");
    expect(yaml).toContain("\\x7f");
    const parsed = yamlToObject(yaml) as {
      tests: { json: { payload: string } }[];
    };
    expect(parsed.tests[0]!.json.payload).toBe("before\tafter\x00null\x7fdel");
  });
});

// ARV-162 (round-08 F19): form values are always strings on the wire —
// emitting `phone: +1234567890` or `width: 12.5` made YAML parse them as
// int/float and `zond check tests` reject the suite (21/68 silent skips).
// Every form value must round-trip as a string.
describe("ARV-162: form values are force-quoted", () => {
  test("decimals stay strings", () => {
    const suite: RawSuite = {
      name: "s",
      tests: [
        {
          name: "create",
          POST: "/v1/products",
          form: { "package_dimensions[height]": "12.5" } as unknown as Record<string, string>,
          expect: { status: 200 },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    const parsed = yamlToObject(yaml) as {
      tests: { form: Record<string, unknown> }[];
    };
    expect(typeof parsed.tests[0]!.form["package_dimensions[height]"]).toBe("string");
    expect(parsed.tests[0]!.form["package_dimensions[height]"]).toBe("12.5");
  });

  test("phone numbers with leading + stay strings", () => {
    const suite: RawSuite = {
      name: "s",
      tests: [
        {
          name: "create",
          POST: "/v1/customers",
          form: { phone: "+1234567890" },
          expect: { status: 200 },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    const parsed = yamlToObject(yaml) as { tests: { form: { phone: unknown } }[] };
    expect(typeof parsed.tests[0]!.form.phone).toBe("string");
    expect(parsed.tests[0]!.form.phone).toBe("+1234567890");
  });

  test("pure integers stay strings", () => {
    const suite: RawSuite = {
      name: "s",
      tests: [
        {
          name: "create",
          POST: "/v1/charges",
          form: { application_fee_percent: "25" },
          expect: { status: 200 },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    const parsed = yamlToObject(yaml) as {
      tests: { form: { application_fee_percent: unknown } }[];
    };
    expect(typeof parsed.tests[0]!.form.application_fee_percent).toBe("string");
    expect(parsed.tests[0]!.form.application_fee_percent).toBe("25");
  });

  test("the suite roundtrips through validateSuite", () => {
    const suite: RawSuite = {
      name: "s",
      tests: [
        {
          name: "create",
          POST: "/v1/products",
          form: {
            phone: "+1",
            "package_dimensions[height]": "12.5",
            application_fee_percent: "25",
          },
          expect: { status: 200 },
        },
      ],
    };
    const yaml = serializeSuite(suite);
    const obj = yamlToObject(yaml);
    expect(() => validateSuite(obj)).not.toThrow();
  });
});

function yamlToObject(yaml: string): unknown {
  return Bun.YAML.parse(yaml);
}
