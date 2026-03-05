import { z } from "zod";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  scanCoveredEndpoints,
  filterUncoveredEndpoints,
  serializeSuite,
  generateSuites,
  findUnresolvedVars,
} from "../../core/generator/index.ts";
import { loadEnvironment } from "../../core/parser/variables.ts";
import { compressEndpointsWithSchemas, buildGenerationGuide } from "../../core/generator/guide-builder.ts";
import { findCollectionBySpec } from "../../db/queries.ts";
import { planChunks, filterByTag } from "../../core/generator/chunker.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";
import { validateAndSave } from "./save-test-suite.ts";

export function registerGenerateAndSaveTool(server: McpServer) {
  server.registerTool("generate_and_save", {
    description: TOOL_DESCRIPTIONS.generate_and_save,
    inputSchema: {
      specPath: z.string().describe("Path or URL to OpenAPI spec file"),
      outputDir: z.optional(z.string()).describe("Directory for saving test files (default: ./tests/)"),
      tag: z.optional(z.string()).describe("Generate tests only for this tag's endpoints"),
      methodFilter: z.optional(z.array(z.string())).describe("Only include endpoints with these HTTP methods (e.g. [\"GET\"] for smoke tests)"),
      testsDir: z.optional(z.string()).describe("Path to existing tests directory — filters to uncovered endpoints only"),
      overwrite: z.optional(z.boolean()).describe("Hint for save_test_suites overwrite behavior (default: false)"),
      includeFormat: z.optional(z.boolean()).describe("Include YAML format reference (default: true, set false for subsequent tag chunks)"),
      mode: z.optional(z.enum(["generate", "guide"])).describe(
        "'generate' creates and saves YAML test files deterministically (default), 'guide' returns text for LLM-crafted tests"
      ),
    },
  }, async ({ specPath, outputDir, tag, methodFilter, testsDir, overwrite, includeFormat, mode }) => {
    try {
      const doc = await readOpenApiSpec(specPath);
      let endpoints = extractEndpoints(doc);
      const securitySchemes = extractSecuritySchemes(doc);
      const baseUrl = ((doc as any).servers?.[0]?.url) as string | undefined;
      const title = (doc as any).info?.title as string | undefined;
      let effectiveOutputDir = outputDir;
      if (!effectiveOutputDir) {
        const collection = findCollectionBySpec(specPath);
        effectiveOutputDir = collection?.test_path ?? "./tests/";
      }
      const effectiveMode = mode ?? "generate";

      // Apply method filter
      if (methodFilter && methodFilter.length > 0) {
        const methods = methodFilter.map(m => m.toUpperCase());
        endpoints = endpoints.filter(ep => methods.includes(ep.method.toUpperCase()));
      }

      // Coverage filtering
      let coverageInfo: { covered: number; total: number; percentage: number } | undefined;
      if (testsDir) {
        const totalBefore = endpoints.length;
        const covered = await scanCoveredEndpoints(testsDir);
        const uncovered = filterUncoveredEndpoints(endpoints, covered);
        const coveredCount = totalBefore - uncovered.length;
        const percentage = totalBefore > 0 ? Math.round((coveredCount / totalBefore) * 100) : 100;
        coverageInfo = { covered: coveredCount, total: totalBefore, percentage };
        endpoints = uncovered;
      }

      if (endpoints.length === 0) {
        const msg = testsDir
          ? { fullyCovered: true, ...coverageInfo }
          : { error: "No endpoints found in the spec" };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(msg, null, 2) }],
          isError: !testsDir,
        };
      }

      // Tag filtering
      if (tag) {
        endpoints = filterByTag(endpoints, tag);
        if (endpoints.length === 0) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `No endpoints found for tag "${tag}"` }, null, 2) }],
            isError: true,
          };
        }
      }

      const plan = planChunks(endpoints);

      // Plan mode: large API without specific tag
      if (plan.needsChunking && !tag) {
        const result: Record<string, unknown> = {
          mode: "plan",
          title: title ?? "API",
          totalEndpoints: plan.totalEndpoints,
          chunks: plan.chunks,
          instruction:
            `This API has ${plan.totalEndpoints} endpoints across ${plan.chunks.length} tags. ` +
            `Call generate_and_save with tag parameter for each chunk sequentially. ` +
            (effectiveMode === "guide"
              ? `Pass includeFormat: false for subsequent chunks to save tokens. `
              : "") +
            `Example: generate_and_save(specPath: '${specPath}', tag: '${plan.chunks[0].tag}'` +
            (effectiveMode === "guide" ? `, mode: 'guide'` : "") + `)`,
        };
        if (coverageInfo) {
          result.coverage = coverageInfo;
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      }

      // ── Generate mode: deterministic YAML generation ──
      if (effectiveMode === "generate") {
        const suites = generateSuites({ endpoints, securitySchemes });

        const files: Array<{
          saved: boolean;
          filePath: string;
          tests: number;
          error?: string;
        }> = [];

        for (const suite of suites) {
          const yaml = serializeSuite(suite);
          const fileName = (suite.fileStem ?? suite.name) + ".yaml";
          const filePath = join(effectiveOutputDir, fileName);

          const { result: saveResult } = await validateAndSave(filePath, yaml, overwrite ?? false);
          files.push({
            saved: saveResult.saved,
            filePath: saveResult.filePath ?? filePath,
            tests: suite.tests.length,
            ...(saveResult.error ? { error: saveResult.error } : {}),
          });
        }

        const warnings: string[] = [];
        const env = await loadEnvironment(undefined, effectiveOutputDir);
        const envKeys = new Set(Object.keys(env));
        for (const suite of suites) {
          const unresolved = findUnresolvedVars(suite, envKeys);
          if (unresolved.length > 0)
            warnings.push(`${suite.fileStem ?? suite.name}.yaml: unresolved [${unresolved.join(", ")}]`);
        }

        const response: Record<string, unknown> = {
          mode: "generate",
          suitesGenerated: suites.length,
          files,
          ...(warnings.length > 0 ? { warnings } : {}),
          hint: files.some(f => !f.saved)
            ? "Some files were not saved (already exist?). Use overwrite: true to replace."
            : "Files saved. Run run_tests to verify. Use mode: 'guide' for LLM-crafted tests with more detail.",
        };
        if (coverageInfo) {
          response.coverage = coverageInfo;
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      }

      // ── Guide mode: text-based generation guide ──
      const coverageHeader = coverageInfo
        ? `## Coverage: ${coverageInfo.covered}/${coverageInfo.total} endpoints covered (${coverageInfo.percentage}%). Generating tests for ${endpoints.length} uncovered endpoints:`
        : undefined;

      const apiContext = compressEndpointsWithSchemas(endpoints, securitySchemes);
      const guide = buildGenerationGuide({
        title: tag ? `${title ?? "API"} — tag: ${tag}` : (title ?? "API"),
        baseUrl,
        apiContext,
        outputDir: effectiveOutputDir,
        securitySchemes,
        endpointCount: endpoints.length,
        coverageHeader,
        includeFormat: includeFormat ?? true,
      });

      const saveInstructions = `
---
## Save Instructions
- Output directory: ${effectiveOutputDir}
- Use \`save_test_suites\` to save all generated files in one call
- Overwrite: ${overwrite ? "true" : "false (set overwrite: true in save_test_suites to replace existing files)"}
- After saving, run \`run_tests\` to verify`;

      return {
        content: [{ type: "text" as const, text: guide + saveInstructions }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
