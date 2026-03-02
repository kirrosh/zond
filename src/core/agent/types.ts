import type { AIProviderConfig } from "../generator/ai/types.ts";

export interface AgentConfig {
  provider: AIProviderConfig;
  safeMode?: boolean;
  dbPath?: string;
  maxSteps?: number;
}

export interface ToolEvent {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: string;
}

export interface AgentTurnResult {
  text: string;
  toolEvents: ToolEvent[];
  inputTokens: number;
  outputTokens: number;
}
