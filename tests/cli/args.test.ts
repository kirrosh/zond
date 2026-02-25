import { describe, test, expect } from "bun:test";
import { parseArgs } from "../../src/cli/index.ts";

// parseArgs expects full argv: [bunPath, scriptPath, ...userArgs]
function parse(...userArgs: string[]) {
  return parseArgs(["bun", "script.ts", ...userArgs]);
}

describe("parseArgs", () => {
  test("run command with path", () => {
    const result = parse("run", "tests/");
    expect(result.command).toBe("run");
    expect(result.positional).toEqual(["tests/"]);
    expect(result.flags).toEqual({});
  });

  test("run with all flags", () => {
    const result = parse("run", "test.yaml", "--env", "staging", "--report", "json", "--timeout", "5000", "--bail");
    expect(result.command).toBe("run");
    expect(result.positional).toEqual(["test.yaml"]);
    expect(result.flags).toEqual({
      env: "staging",
      report: "json",
      timeout: "5000",
      bail: true,
    });
  });

  test("validate command", () => {
    const result = parse("validate", "test.yaml");
    expect(result.command).toBe("validate");
    expect(result.positional).toEqual(["test.yaml"]);
  });

  test("--help flag", () => {
    const result = parse("--help");
    expect(result.command).toBe(undefined);
    expect(result.flags["help"]).toBe(true);
  });

  test("-h short flag", () => {
    const result = parse("-h");
    expect(result.command).toBe(undefined);
    expect(result.flags["h"]).toBe(true);
  });

  test("no arguments", () => {
    const result = parse();
    expect(result.command).toBe(undefined);
    expect(result.positional).toEqual([]);
    expect(result.flags).toEqual({});
  });

  test("--flag=value syntax", () => {
    const result = parse("run", "tests/", "--report=json");
    expect(result.flags["report"]).toBe("json");
  });

  test("unknown command captured as command", () => {
    const result = parse("foobar");
    expect(result.command).toBe("foobar");
  });
});
