import { Hono } from "hono";
import { fragment, escapeHtml } from "../views/layout.ts";
import { generateWithAI } from "../../core/generator/ai/ai-generator.ts";
import { resolveProviderConfig } from "../../core/generator/ai/types.ts";
import type { AIProviderConfig } from "../../core/generator/ai/types.ts";
import {
  getCollectionById,
  saveAIGeneration,
  listAIGenerations,
  findAIGenerationByYaml,
  updateAIGenerationOutputPath,
  getAIGeneration,
} from "../../db/queries.ts";

const aiGenerate = new Hono();

// POST /api/ai-generate — generate test suite from prompt
aiGenerate.post("/api/ai-generate", async (c) => {
  const body = await c.req.parseBody();
  const prompt = (body["prompt"] as string ?? "").trim();
  const providerName = (body["provider"] as string ?? "ollama") as AIProviderConfig["provider"];
  const model = (body["model"] as string ?? "").trim();
  const baseUrlInput = (body["base_url"] as string ?? "").trim();
  const apiKey = (body["api_key"] as string ?? "").trim();
  const collectionIdStr = body["collection_id"] as string ?? "";
  const specPath = (body["spec_path"] as string ?? "").trim();
  const collectionId = collectionIdStr ? parseInt(collectionIdStr, 10) : undefined;

  if (!prompt) {
    return c.html(fragment(`<div class="ai-error">Please enter a test scenario description.</div>`));
  }

  if (!specPath) {
    return c.html(fragment(`<div class="ai-error">No OpenAPI spec path available for this collection.</div>`));
  }

  const provider = resolveProviderConfig({
    provider: providerName,
    model: model || undefined,
    baseUrl: baseUrlInput || undefined,
    apiKey: apiKey || undefined,
  });

  const startTime = Date.now();

  try {
    const result = await generateWithAI({
      specPath,
      prompt,
      provider,
      baseUrl: baseUrlInput || undefined,
      collectionId,
    });

    const durationMs = Date.now() - startTime;

    // Save to DB
    if (collectionId) {
      saveAIGeneration({
        collection_id: collectionId,
        prompt,
        model: result.model,
        provider: providerName,
        generated_yaml: result.yaml,
        status: "success",
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        duration_ms: durationMs,
      });
    }

    return c.html(fragment(`
      <div class="ai-result">
        <div class="ai-result-header">
          <span class="badge badge-pass">Generated</span>
          <span style="color:var(--text-dim);font-size:0.85rem;">
            ${escapeHtml(result.model)} &middot; ${(durationMs / 1000).toFixed(1)}s
            ${result.promptTokens ? ` &middot; ${result.promptTokens}+${result.completionTokens} tokens` : ""}
          </span>
        </div>
        <div class="ai-yaml-preview">
          <pre><code>${escapeHtml(result.yaml)}</code></pre>
        </div>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;">
          <form hx-post="/api/ai-generate/save" hx-target="#ai-result" hx-swap="innerHTML">
            <input type="hidden" name="yaml" value="${escapeHtml(result.yaml)}">
            <input type="hidden" name="collection_id" value="${collectionId ?? ""}">
            <input type="hidden" name="spec_path" value="${escapeHtml(specPath)}">
            <button type="submit" class="btn btn-sm btn-run">Save & Add to Collection</button>
          </form>
          <button type="button" class="btn btn-sm btn-outline" onclick="this.closest('.ai-result').remove()">Discard</button>
        </div>
      </div>
    `));
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Save error to DB
    if (collectionId) {
      saveAIGeneration({
        collection_id: collectionId,
        prompt,
        model: provider.model,
        provider: providerName,
        status: "error",
        error_message: errorMsg,
        duration_ms: durationMs,
      });
    }

    return c.html(fragment(`
      <div class="ai-error">
        <strong>Generation failed:</strong> ${escapeHtml(errorMsg)}
      </div>
    `));
  }
});

// POST /api/ai-generate/save — save generated YAML to file and collection
aiGenerate.post("/api/ai-generate/save", async (c) => {
  const body = await c.req.parseBody();
  const yaml = body["yaml"] as string ?? "";
  const collectionIdStr = body["collection_id"] as string ?? "";
  const specPath = body["spec_path"] as string ?? "";
  const collectionId = collectionIdStr ? parseInt(collectionIdStr, 10) : undefined;

  if (!yaml || !collectionId) {
    return c.html(fragment(`<div class="ai-error">Missing data for save.</div>`));
  }

  const collection = getCollectionById(collectionId);
  if (!collection) {
    return c.html(fragment(`<div class="ai-error">Collection not found.</div>`));
  }

  try {
    const { mkdir } = await import("node:fs/promises");
    const testDir = collection.test_path;
    await mkdir(testDir, { recursive: true });

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `ai-generated-${timestamp}.yaml`;
    const filePath = `${testDir}/${fileName}`;

    await Bun.write(filePath, yaml);

    // Update the AI generation record with output_path
    const genRecord = findAIGenerationByYaml(collectionId, yaml);
    if (genRecord) {
      updateAIGenerationOutputPath(genRecord.id, filePath);
    }

    // Return confirmation fragment instead of redirect
    const isHtmx = c.req.header("HX-Request") === "true";
    if (isHtmx) {
      return c.html(fragment(`
        <div class="ai-save-confirmation">
          <span class="badge badge-pass">Saved</span>
          <div style="margin-top:0.5rem;font-size:0.9rem;">
            Saved to: <code>${escapeHtml(filePath)}</code>
          </div>
          <div style="margin-top:0.75rem;">
            <a class="btn btn-sm" href="/collections/${collectionId}">View Collection</a>
          </div>
        </div>
      `));
    }
    return c.redirect(`/collections/${collectionId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return c.html(fragment(`<div class="ai-error">Save failed: ${escapeHtml(errorMsg)}</div>`));
  }
});

// POST /api/ai-generate/delete-file — delete a broken/unwanted file
aiGenerate.post("/api/ai-generate/delete-file", async (c) => {
  const body = await c.req.parseBody();
  const filePath = (body["file_path"] as string ?? "").trim();
  const collectionIdStr = (body["collection_id"] as string ?? "");
  const collectionId = collectionIdStr ? parseInt(collectionIdStr, 10) : undefined;

  if (!filePath || !collectionId) {
    return c.html(fragment(`<div class="ai-error">Missing file path or collection.</div>`), 400);
  }

  const collection = getCollectionById(collectionId);
  if (!collection) {
    return c.html(fragment(`<div class="ai-error">Collection not found.</div>`), 404);
  }

  // Security: resolve the file path relative to the collection's test_path
  const { resolve } = await import("node:path");
  const { unlink } = await import("node:fs/promises");
  const resolvedFile = resolve(collection.test_path, filePath);
  const resolvedTestDir = resolve(collection.test_path);

  if (!resolvedFile.startsWith(resolvedTestDir)) {
    return c.html(fragment(`<div class="ai-error">File is outside the collection test path.</div>`), 403);
  }

  try {
    await unlink(resolvedFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.html(fragment(`<div class="ai-error">Delete failed: ${escapeHtml(msg)}</div>`), 500);
  }

  // Return empty string so hx-swap="outerHTML" removes the row
  return c.html("");
});

// GET /api/ai-generation/:id — view generation details (HTMX fragment)
aiGenerate.get("/api/ai-generation/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const gen = getAIGeneration(id);
  if (!gen) {
    return c.html(fragment(`<div class="ai-error">Generation not found.</div>`), 404);
  }

  const meta = [
    `<strong>Model:</strong> ${escapeHtml(gen.model)}`,
    gen.duration_ms != null ? `<strong>Duration:</strong> ${(gen.duration_ms / 1000).toFixed(1)}s` : "",
    gen.prompt_tokens ? `<strong>Tokens:</strong> ${gen.prompt_tokens}+${gen.completion_tokens}` : "",
    gen.output_path ? `<strong>File:</strong> <code>${escapeHtml(gen.output_path)}</code>` : `<em>Not saved to file</em>`,
  ].filter(Boolean).join(" &middot; ");

  return c.html(fragment(`
    <tr class="ai-gen-detail-row">
      <td colspan="6">
        <div class="ai-gen-detail">
          <div class="ai-gen-detail-meta">${meta}</div>
          <div class="ai-gen-detail-prompt"><strong>Prompt:</strong> ${escapeHtml(gen.prompt)}</div>
          ${gen.generated_yaml ? `
            <pre class="ai-gen-detail-yaml"><code>${escapeHtml(gen.generated_yaml)}</code></pre>
          ` : `<p style="color:var(--text-dim)">No YAML (generation failed)</p>`}
        </div>
      </td>
    </tr>
  `));
});

export default aiGenerate;
