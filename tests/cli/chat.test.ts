import { describe, test, expect } from "bun:test";
import { parseArgs } from "../../src/cli/index.ts";

function parse(...userArgs: string[]) {
  return parseArgs(["bun", "script.ts", ...userArgs]);
}

describe("chat command parsing", () => {
  test("basic chat command", () => {
    const result = parse("chat");
    expect(result.command).toBe("chat");
    expect(result.positional).toEqual([]);
  });

  test("chat with --provider openai --model gpt-4o", () => {
    const result = parse("chat", "--provider", "openai", "--model", "gpt-4o");
    expect(result.command).toBe("chat");
    expect(result.flags["provider"]).toBe("openai");
    expect(result.flags["model"]).toBe("gpt-4o");
  });

  test("chat with --safe flag", () => {
    const result = parse("chat", "--safe");
    expect(result.command).toBe("chat");
    expect(result.flags["safe"]).toBe(true);
  });

  test("chat with --api-key", () => {
    const result = parse("chat", "--provider", "anthropic", "--api-key", "sk-ant-test");
    expect(result.flags["provider"]).toBe("anthropic");
    expect(result.flags["api-key"]).toBe("sk-ant-test");
  });

  test("default provider is handled by command implementation", () => {
    const result = parse("chat");
    expect(result.flags["provider"]).toBeUndefined();
  });
});
