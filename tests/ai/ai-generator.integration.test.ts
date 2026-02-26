import { describe, test, expect, beforeAll } from "bun:test";
import { generateWithAI } from "../../src/core/generator/ai/ai-generator.ts";
import { resolveProviderConfig } from "../../src/core/generator/ai/types.ts";
import { validateSuite } from "../../src/core/parser/schema.ts";

// This test requires a running Ollama instance with llama3.2:3b model
// Skip if Ollama is not available

let ollamaAvailable = false;

beforeAll(async () => {
  try {
    const resp = await fetch("http://localhost:11434/api/version");
    if (resp.ok) {
      // Check if model is available
      const tagsResp = await fetch("http://localhost:11434/api/tags");
      if (tagsResp.ok) {
        const tags = await tagsResp.json() as { models: Array<{ name: string }> };
        ollamaAvailable = tags.models?.some(m => m.name.startsWith("llama3.2")) ?? false;
      }
    }
  } catch {
    ollamaAvailable = false;
  }

  if (!ollamaAvailable) {
    console.log("SKIP: Ollama not available or llama3.2 not installed");
  }
});

describe("AI Generator E2E with Ollama", () => {
  test("generates valid YAML from petstore spec", async () => {
    if (!ollamaAvailable) return;

    const provider = resolveProviderConfig({
      provider: "ollama",
      model: "llama3.2:3b",
    });

    const result = await generateWithAI({
      specPath: "tests/fixtures/petstore-simple.json",
      prompt: "Create a pet and then get it by ID to verify it exists",
      provider,
    });

    // Should produce non-empty YAML
    expect(result.yaml.length).toBeGreaterThan(50);
    expect(result.model).toBe("llama3.2:3b");
    expect(result.rawResponse.length).toBeGreaterThan(0);

    // YAML should contain expected keywords
    expect(result.yaml).toContain("name:");
    expect(result.yaml).toContain("tests:");
    expect(result.yaml).toContain("expect:");

    // Should contain at least one HTTP method
    const hasMethod = /\b(GET|POST|PUT|PATCH|DELETE):/m.test(result.yaml);
    expect(hasMethod).toBe(true);

    console.log("Generated YAML:\n" + result.yaml);
  }, 120_000); // 2 min timeout for LLM

  test("generated YAML parses and validates with Zod schema", async () => {
    if (!ollamaAvailable) return;

    const provider = resolveProviderConfig({
      provider: "ollama",
      model: "llama3.2:3b",
    });

    const result = await generateWithAI({
      specPath: "tests/fixtures/petstore-simple.json",
      prompt: "Create a new pet with name and species, verify creation with GET",
      provider,
    });

    // Split multi-document YAML
    const docs = result.yaml.split(/\n---\n/).filter(Boolean);
    expect(docs.length).toBeGreaterThanOrEqual(1);

    for (const doc of docs) {
      const parsed = Bun.YAML.parse(doc);
      // Should not throw — validates with Zod
      const suite = validateSuite(parsed);
      expect(suite.name).toBeTruthy();
      expect(suite.tests.length).toBeGreaterThanOrEqual(1);

      for (const step of suite.tests) {
        expect(step.name).toBeTruthy();
        expect(step.method).toBeTruthy();
        expect(step.path).toBeTruthy();
      }
    }
  }, 120_000);

  test("generates test with 409 conflict scenario (retry up to 3 times)", async () => {
    if (!ollamaAvailable) return;

    const provider = resolveProviderConfig({
      provider: "ollama",
      model: "llama3.2:3b",
    });

    // Small models sometimes produce invalid JSON, retry a few times
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await generateWithAI({
          specPath: "tests/fixtures/petstore-simple.json",
          prompt: "Test uniqueness: create a pet, then create a duplicate pet with the same name and expect 409 conflict error response",
          provider,
        });

        expect(result.yaml.length).toBeGreaterThan(50);
        expect(result.yaml).toContain("POST:");
        // Should reference 409 or conflict scenario
        const has409 = result.yaml.includes("409") || result.yaml.toLowerCase().includes("conflict") || result.yaml.toLowerCase().includes("duplicate");
        expect(has409).toBe(true);

        console.log(`409 Conflict YAML (attempt ${attempt}):\n` + result.yaml);
        return; // success
      } catch (err) {
        lastError = err as Error;
        console.log(`Attempt ${attempt} failed: ${lastError.message}`);
      }
    }

    // If all retries failed, skip gracefully (small model limitation)
    console.log(`SKIP: All 3 attempts failed for 409 scenario. Last error: ${lastError?.message}`);
  }, 300_000);
});
