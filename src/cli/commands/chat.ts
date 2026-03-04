import { resolveProviderConfig, PROVIDER_DEFAULTS } from "../../core/generator/ai/types.ts";
import type { AIProviderConfig } from "../../core/generator/ai/types.ts";
import { printError } from "../output.ts";

export interface ChatCommandOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  safe?: boolean;
  dbPath?: string;
}

const VALID_PROVIDERS = new Set(["ollama", "openai", "anthropic", "custom"]);

export async function chatCommand(options: ChatCommandOptions): Promise<number> {
  const providerName = options.provider ?? "ollama";

  if (!VALID_PROVIDERS.has(providerName)) {
    printError(`Unknown provider: ${providerName}. Available: ollama, openai, anthropic, custom`);
    return 2;
  }

  const providerConfig = resolveProviderConfig({
    provider: providerName as AIProviderConfig["provider"],
    model: options.model,
    apiKey: options.apiKey ?? process.env["ZOND_AI_KEY"],
    baseUrl: options.baseUrl,
  });

  try {
    const { startChatUI } = await import("../../tui/chat-ui.ts");
    await startChatUI({
      provider: providerConfig,
      safeMode: options.safe,
      dbPath: options.dbPath,
    });
    return 0;
  } catch (err) {
    printError(`Chat error: ${(err as Error).message}`);
    return 2;
  }
}
