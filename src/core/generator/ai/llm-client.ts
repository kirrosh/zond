import type { AIProviderConfig } from "./types.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

export async function chatCompletion(
  config: AIProviderConfig,
  messages: ChatMessage[],
): Promise<ChatCompletionResult> {
  if (config.provider === "anthropic") {
    return callAnthropic(config, messages);
  }
  return callOpenAICompatible(config, messages);
}

async function callOpenAICompatible(
  config: AIProviderConfig,
  messages: ChatMessage[],
): Promise<ChatCompletionResult> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxTokens ?? 4096,
  };

  // Request JSON output where supported (OpenAI, newer Ollama models)
  if (config.provider === "openai") {
    body.response_format = { type: "json_object" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM request failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  return {
    content,
    usage: {
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    },
  };
}

async function callAnthropic(
  config: AIProviderConfig,
  messages: ChatMessage[],
): Promise<ChatCompletionResult> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/messages`;

  // Separate system prompt from user/assistant messages
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  const systemText = systemMessages.map((m) => m.content).join("\n\n");

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    temperature: config.temperature ?? 0.2,
    messages: nonSystemMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  if (systemText) {
    body.system = systemText;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic request failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; text: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const content = data.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("") ?? "";

  return {
    content,
    usage: {
      promptTokens: data.usage?.input_tokens,
      completionTokens: data.usage?.output_tokens,
    },
  };
}
