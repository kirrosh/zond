import { describe, test, expect } from "bun:test";
import { chatCompletion } from "../../src/core/generator/ai/llm-client.ts";
import type { AIProviderConfig } from "../../src/core/generator/ai/types.ts";

describe("llm-client", () => {
  test("sends correct headers for openai provider", async () => {
    let capturedRequest: { url: string; headers: Record<string, string>; body: any } | null = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      capturedRequest = {
        url: typeof input === "string" ? input : input.url,
        headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
        body: JSON.parse(init?.body ?? "{}"),
      };
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"suites":[]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const config: AIProviderConfig = {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test-key",
        model: "gpt-4o",
        temperature: 0.2,
        maxTokens: 4096,
      };

      const result = await chatCompletion(config, [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hello" },
      ]);

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.url).toBe("https://api.openai.com/v1/chat/completions");
      expect(capturedRequest!.headers["Authorization"]).toBe("Bearer sk-test-key");
      expect(capturedRequest!.headers["Content-Type"]).toBe("application/json");
      expect(capturedRequest!.body.model).toBe("gpt-4o");
      expect(capturedRequest!.body.messages.length).toBe(2);
      expect(capturedRequest!.body.response_format).toEqual({ type: "json_object" });
      expect(result.content).toBe('{"suites":[]}');
      expect(result.usage.promptTokens).toBe(10);
      expect(result.usage.completionTokens).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sends correct format for anthropic provider", async () => {
    let capturedRequest: { url: string; headers: Record<string, string>; body: any } | null = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any) => {
      capturedRequest = {
        url: typeof input === "string" ? input : input.url,
        headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
        body: JSON.parse(init?.body ?? "{}"),
      };
      return new Response(JSON.stringify({
        content: [{ type: "text", text: '{"suites":[]}' }],
        usage: { input_tokens: 20, output_tokens: 10 },
      }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const config: AIProviderConfig = {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
        model: "claude-sonnet-4-20250514",
        temperature: 0.2,
        maxTokens: 4096,
      };

      const result = await chatCompletion(config, [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message" },
      ]);

      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.url).toBe("https://api.anthropic.com/v1/messages");
      expect(capturedRequest!.headers["x-api-key"]).toBe("sk-ant-test");
      expect(capturedRequest!.headers["anthropic-version"]).toBe("2023-06-01");
      // System should be top-level, not in messages
      expect(capturedRequest!.body.system).toBe("System prompt");
      expect(capturedRequest!.body.messages.length).toBe(1); // only user message
      expect(capturedRequest!.body.messages[0].role).toBe("user");
      expect(result.content).toBe('{"suites":[]}');
      expect(result.usage.promptTokens).toBe(20);
      expect(result.usage.completionTokens).toBe(10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses ollama path without Authorization when no apiKey", async () => {
    let capturedHeaders: Record<string, string> = {};

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: any, init: any) => {
      capturedHeaders = Object.fromEntries(Object.entries(init?.headers ?? {}));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "test" } }],
      }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const config: AIProviderConfig = {
        provider: "ollama",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.2",
      };

      await chatCompletion(config, [{ role: "user", content: "hi" }]);
      expect(capturedHeaders["Authorization"]).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws on HTTP error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response("Rate limit exceeded", { status: 429 });
    }) as unknown as typeof fetch;

    try {
      const config: AIProviderConfig = {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        model: "gpt-4o",
      };

      await expect(
        chatCompletion(config, [{ role: "user", content: "hi" }])
      ).rejects.toThrow("429");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
