import { describe, test, expect } from "bun:test";
import { buildProvider } from "../../src/core/agent/agent-loop.ts";
import type { AgentConfig } from "../../src/core/agent/types.ts";

function makeConfig(overrides: Partial<AgentConfig["provider"]> = {}): AgentConfig {
  return {
    provider: {
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      model: "qwen3:4b",
      ...overrides,
    },
  };
}

describe("buildProvider", () => {
  test("returns an OpenAI-compatible provider for ollama", () => {
    const config = makeConfig({ provider: "ollama" });
    const provider = buildProvider(config);
    expect(typeof provider).toBe("function");
  });

  test("returns an OpenAI-compatible provider for openai", () => {
    const config = makeConfig({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "sk-test",
    });
    const provider = buildProvider(config);
    expect(typeof provider).toBe("function");
  });

  test("returns an Anthropic provider for anthropic", () => {
    const config = makeConfig({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-20250514",
      apiKey: "sk-ant-test",
    });
    const provider = buildProvider(config);
    expect(typeof provider).toBe("function");
  });

  test("returns an OpenAI-compatible provider for custom", () => {
    const config = makeConfig({
      provider: "custom",
      baseUrl: "http://custom:8080/v1",
      model: "my-model",
    });
    const provider = buildProvider(config);
    expect(typeof provider).toBe("function");
  });
});

describe("runAgentTurn", () => {
  test("module exports runAgentTurn function", async () => {
    const mod = await import("../../src/core/agent/agent-loop.ts");
    expect(typeof mod.runAgentTurn).toBe("function");
  });
});
