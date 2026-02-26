import { describe, test, expect } from "bun:test";
import { resolveProviderConfig, PROVIDER_DEFAULTS } from "../../src/core/generator/ai/types.ts";

describe("AI types", () => {
  test("resolveProviderConfig fills ollama defaults", () => {
    const config = resolveProviderConfig({ provider: "ollama" });
    expect(config.baseUrl).toBe("http://localhost:11434/v1");
    expect(config.model).toBe("llama3.2:3b");
    expect(config.temperature).toBe(0.2);
    expect(config.maxTokens).toBe(4096);
    expect(config.apiKey).toBeUndefined();
  });

  test("resolveProviderConfig fills openai defaults", () => {
    const config = resolveProviderConfig({ provider: "openai", apiKey: "sk-test" });
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.model).toBe("gpt-4o");
    expect(config.apiKey).toBe("sk-test");
  });

  test("resolveProviderConfig fills anthropic defaults", () => {
    const config = resolveProviderConfig({ provider: "anthropic" });
    expect(config.baseUrl).toBe("https://api.anthropic.com");
    expect(config.model).toBe("claude-sonnet-4-20250514");
  });

  test("resolveProviderConfig allows overrides", () => {
    const config = resolveProviderConfig({
      provider: "ollama",
      baseUrl: "http://custom:1234/v1",
      model: "custom-model",
      temperature: 0.8,
      maxTokens: 2048,
    });
    expect(config.baseUrl).toBe("http://custom:1234/v1");
    expect(config.model).toBe("custom-model");
    expect(config.temperature).toBe(0.8);
    expect(config.maxTokens).toBe(2048);
  });

  test("custom provider uses empty defaults", () => {
    const config = resolveProviderConfig({
      provider: "custom",
      baseUrl: "http://my-llm/v1",
      model: "my-model",
    });
    expect(config.provider).toBe("custom");
    expect(config.baseUrl).toBe("http://my-llm/v1");
    expect(config.model).toBe("my-model");
  });

  test("PROVIDER_DEFAULTS has expected keys", () => {
    expect(Object.keys(PROVIDER_DEFAULTS)).toEqual(["ollama", "openai", "anthropic"]);
  });
});
