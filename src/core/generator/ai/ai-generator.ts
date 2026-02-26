import type { AIGenerateOptions, AIGenerateResult } from "./types.ts";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../openapi-reader.ts";
import { buildMessages } from "./prompt-builder.ts";
import { chatCompletion } from "./llm-client.ts";
import { parseAIResponse } from "./output-parser.ts";

export async function generateWithAI(options: AIGenerateOptions): Promise<AIGenerateResult> {
  // 1. Read OpenAPI spec
  const doc = await readOpenApiSpec(options.specPath);

  // 2. Extract endpoints + security schemes
  const endpoints = extractEndpoints(doc);
  if (endpoints.length === 0) {
    throw new Error("No endpoints found in the OpenAPI spec");
  }
  const securitySchemes = extractSecuritySchemes(doc);

  // Determine base URL: explicit option, or from spec servers[0]
  const baseUrl = options.baseUrl ?? (doc as any).servers?.[0]?.url as string | undefined;

  // 3. Build prompt
  const messages = buildMessages(endpoints, securitySchemes, options.prompt, baseUrl);

  // 4. Call LLM
  const startTime = Date.now();
  const llmResult = await chatCompletion(options.provider, messages);
  const durationMs = Date.now() - startTime;

  // 5. Parse + validate output
  const parsed = parseAIResponse(llmResult.content);

  if (parsed.suites.length === 0) {
    const errorDetail = parsed.errors.length > 0
      ? parsed.errors.join("; ")
      : "No valid suites in response";
    throw new Error(`AI generation failed: ${errorDetail}`);
  }

  // If there are validation errors but we still got suites, include them as warnings
  const yaml = parsed.yaml;

  return {
    yaml,
    rawResponse: llmResult.content,
    promptTokens: llmResult.usage.promptTokens,
    completionTokens: llmResult.usage.completionTokens,
    model: options.provider.model,
  };
}
