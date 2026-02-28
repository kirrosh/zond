import { describe, test, expect, mock, beforeEach } from "bun:test";

mock.module("../../../src/core/parser/yaml-parser.ts", () => ({
  parse: mock(() => Promise.resolve([
    { name: "Suite A", tests: [{ name: "t1" }, { name: "t2" }] },
  ])),
  parseDirectorySafe: mock(() => Promise.resolve({
    suites: [{ name: "Suite A", tests: [{ name: "t1" }] }],
    errors: [],
  })),
}));

import { validateTestsTool } from "../../../src/core/agent/tools/validate-tests.ts";
import { parse } from "../../../src/core/parser/yaml-parser.ts";

const toolOpts = { toolCallId: "test", messages: [] as any[] };

describe("validateTestsTool", () => {
  beforeEach(() => {
    (parse as ReturnType<typeof mock>).mockClear();
  });

  test("is an AI SDK v6 tool with inputSchema", () => {
    expect(validateTestsTool).toHaveProperty("inputSchema");
    expect(validateTestsTool).toHaveProperty("execute");
  });

  test("returns valid result for correct YAML", async () => {
    const result = await validateTestsTool.execute!({ testPath: "tests/api.yaml" }, toolOpts);
    expect(result).toEqual({
      valid: true,
      suiteCount: 1,
      totalTests: 2,
      suites: [{ name: "Suite A", testCount: 2 }],
    });
  });

  test("returns structured error on parse failure", async () => {
    (parse as ReturnType<typeof mock>).mockRejectedValueOnce(new Error("Invalid YAML in test.yaml: bad indent"));
    const result = await validateTestsTool.execute!({ testPath: "bad.yaml" }, toolOpts);
    expect(result).toEqual({
      valid: false,
      error: "Invalid YAML in test.yaml: bad indent",
    });
  });

  test("returns valid=true for empty suite list", async () => {
    (parse as ReturnType<typeof mock>).mockResolvedValueOnce([]);
    const result = await validateTestsTool.execute!({ testPath: "empty/" }, toolOpts);
    expect(result).toEqual({
      valid: true,
      suiteCount: 0,
      totalTests: 0,
      suites: [],
    });
  });
});
