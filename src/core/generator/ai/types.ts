export interface AIProviderConfig {
  provider: "ollama" | "openai" | "anthropic" | "custom";
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIGenerateOptions {
  specPath: string;
  prompt: string;
  provider: AIProviderConfig;
  baseUrl?: string;
  collectionId?: number;
}

export interface AIGenerateResult {
  yaml: string;
  rawResponse: string;
  promptTokens?: number;
  completionTokens?: number;
  model: string;
}

export const PROVIDER_DEFAULTS: Record<string, Partial<AIProviderConfig>> = {
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:4b",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
  },
};

export function resolveProviderConfig(partial: Partial<AIProviderConfig> & { provider: AIProviderConfig["provider"] }): AIProviderConfig {
  const defaults = PROVIDER_DEFAULTS[partial.provider] ?? {};
  return {
    provider: partial.provider,
    baseUrl: partial.baseUrl ?? defaults.baseUrl ?? "",
    apiKey: partial.apiKey,
    model: partial.model ?? defaults.model ?? "",
    temperature: partial.temperature ?? 0.2,
    maxTokens: partial.maxTokens ?? 4096,
  };
}
