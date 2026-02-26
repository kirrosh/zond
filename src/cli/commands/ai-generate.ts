import { resolve, dirname } from "path";
import { generateWithAI } from "../../core/generator/ai/ai-generator.ts";
import { resolveProviderConfig } from "../../core/generator/ai/types.ts";
import type { AIProviderConfig } from "../../core/generator/ai/types.ts";
import { printError, printSuccess } from "../output.ts";

export interface AIGenerateCommandOptions {
  from: string;
  prompt: string;
  provider: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  output?: string;
}

export async function aiGenerateCommand(options: AIGenerateCommandOptions): Promise<number> {
  try {
    const providerName = options.provider as AIProviderConfig["provider"];
    if (!["ollama", "openai", "anthropic", "custom"].includes(providerName)) {
      printError(`Unknown provider: ${options.provider}. Use: ollama, openai, anthropic, custom`);
      return 2;
    }

    const provider = resolveProviderConfig({
      provider: providerName,
      model: options.model,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey ?? process.env.APITOOL_AI_KEY,
    });

    console.log(`Provider: ${provider.provider} (${provider.model})`);
    console.log(`Spec: ${options.from}`);
    console.log(`Prompt: ${options.prompt}`);
    console.log(`Generating...`);

    const startTime = Date.now();
    const result = await generateWithAI({
      specPath: options.from,
      prompt: options.prompt,
      provider,
    });
    const durationMs = Date.now() - startTime;

    console.log(`Done in ${(durationMs / 1000).toFixed(1)}s (model: ${result.model})`);
    if (result.promptTokens) {
      console.log(`Tokens: ${result.promptTokens} prompt + ${result.completionTokens} completion`);
    }

    // Write output
    const outputDir = options.output ?? "./generated/ai/";
    const { mkdir } = await import("node:fs/promises");
    await mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `ai-generated-${timestamp}.yaml`;
    const filePath = resolve(outputDir, fileName);

    await Bun.write(filePath, result.yaml);
    printSuccess(`Written: ${filePath}`);

    // Auto-create collection if DB is available
    try {
      const { getDb } = await import("../../db/schema.ts");
      getDb();
      const { findCollectionByTestPath, createCollection, normalizePath, saveAIGeneration } = await import("../../db/queries.ts");
      const normalizedOutput = normalizePath(outputDir);

      let collectionId: number | undefined;
      const existing = findCollectionByTestPath(normalizedOutput);
      if (existing) {
        collectionId = existing.id;
      } else {
        const specName = `AI Tests (${new Date().toLocaleDateString()})`;
        collectionId = createCollection({
          name: specName,
          test_path: normalizedOutput,
          openapi_spec: resolve(options.from),
        });
        printSuccess(`Created collection "${specName}" (id: ${collectionId})`);
      }

      saveAIGeneration({
        collection_id: collectionId,
        prompt: options.prompt,
        model: result.model,
        provider: providerName,
        generated_yaml: result.yaml,
        output_path: filePath,
        status: "success",
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        duration_ms: durationMs,
      });
    } catch {
      // DB not critical
    }

    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
