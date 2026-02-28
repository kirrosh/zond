// Suppress AI SDK v2 spec compatibility warnings for Ollama (cosmetic, tool calling works fine)
(globalThis as any).AI_SDK_LOG_WARNINGS = false;

import { generateText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { AGENT_SYSTEM_PROMPT } from "./system-prompt.ts";
import { buildAgentTools } from "./tools/index.ts";
import type { AgentConfig, AgentTurnResult, ToolEvent } from "./types.ts";
import type { ModelMessage } from "ai";

export function buildProvider(config: AgentConfig) {
  const { provider } = config.provider;

  if (provider === "anthropic") {
    return createAnthropic({
      apiKey: config.provider.apiKey,
      baseURL: config.provider.baseUrl || undefined,
    });
  }

  // openai, ollama, custom all use OpenAI-compatible API
  return createOpenAI({
    apiKey: config.provider.apiKey ?? "ollama",
    baseURL: config.provider.baseUrl,
  });
}

function buildModel(config: AgentConfig) {
  const provider = buildProvider(config);
  const { provider: providerType } = config.provider;

  // For ollama/custom, use .chat() to avoid the responses API which they don't support.
  if (providerType === "ollama" || providerType === "custom") {
    return (provider as ReturnType<typeof createOpenAI>).chat(config.provider.model);
  }

  return provider(config.provider.model);
}

/**
 * Prepare messages with system prompt.
 * Some small/local models (e.g. qwen3 thinking mode via Ollama) break tool calling
 * when a separate `system` message is present. For ollama/custom providers, we inject
 * the system prompt into the first user message instead.
 */
function prepareMessages(
  messages: ModelMessage[],
  config: AgentConfig,
): { system?: string; messages: ModelMessage[] } {
  const { provider } = config.provider;

  if (provider === "ollama" || provider === "custom") {
    // Inject system prompt into first user message to avoid breaking tool calling
    const prepared = [...messages];
    const firstUserIdx = prepared.findIndex(
      (m) => m.role === "user" && typeof m.content === "string",
    );

    if (firstUserIdx >= 0) {
      const msg = prepared[firstUserIdx] as { role: "user"; content: string };
      prepared[firstUserIdx] = {
        ...msg,
        content: `[System instructions]\n${AGENT_SYSTEM_PROMPT}\n[End instructions]\n\n${msg.content}`,
      };
    }

    return { messages: prepared };
  }

  // For OpenAI/Anthropic, use the standard system parameter
  return { system: AGENT_SYSTEM_PROMPT, messages };
}

export async function runAgentTurn(
  messages: ModelMessage[],
  config: AgentConfig,
  onToolEvent?: (event: ToolEvent) => void,
): Promise<AgentTurnResult> {
  const model = buildModel(config);
  const tools = buildAgentTools(config);
  const { system, messages: prepared } = prepareMessages(messages, config);
  const toolEvents: ToolEvent[] = [];

  const result = await generateText({
    model,
    system,
    messages: prepared,
    tools,
    stopWhen: stepCountIs(config.maxSteps ?? 10),
    maxOutputTokens: config.provider.maxTokens ?? 4096,
    onStepFinish: ({ toolCalls, toolResults }) => {
      if (toolCalls) {
        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i]!;
          const toolResult = toolResults?.[i];
          const event: ToolEvent = {
            toolName: call.toolName,
            args: ("input" in call ? call.input : {}) as Record<string, unknown>,
            result: toolResult ?? null,
            timestamp: new Date().toISOString(),
          };
          toolEvents.push(event);
          onToolEvent?.(event);
        }
      }
    },
  });

  return {
    text: result.text,
    toolEvents,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };
}
