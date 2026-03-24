import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  scanCoveredEndpoints,
  filterUncoveredEndpoints,
} from "../../core/generator/index.ts";
import { compressEndpointsWithSchemas, buildGenerationGuide } from "../../core/generator/guide-builder.ts";
import { planChunks, filterByTag } from "../../core/generator/chunker.ts";
import { findCollectionBySpec } from "../../db/queries.ts";
import { printError } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface GuideOptions {
  specPath: string;
  testsDir?: string;
  tag?: string;
  json?: boolean;
}

export async function guideCommand(options: GuideOptions): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    let endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const baseUrl = ((doc as any).servers?.[0]?.url) as string | undefined;
    const title = (doc as any).info?.title as string | undefined;

    let outputDir = options.testsDir;
    if (!outputDir) {
      try {
        const collection = findCollectionBySpec(options.specPath);
        outputDir = collection?.test_path ?? "./tests/";
      } catch {
        outputDir = "./tests/";
      }
    }

    let coverageInfo: { covered: number; total: number; percentage: number } | undefined;
    if (options.testsDir) {
      const totalBefore = endpoints.length;
      const covered = await scanCoveredEndpoints(options.testsDir);
      const uncovered = filterUncoveredEndpoints(endpoints, covered);
      const coveredCount = totalBefore - uncovered.length;
      const percentage = totalBefore > 0 ? Math.round((coveredCount / totalBefore) * 100) : 100;
      coverageInfo = { covered: coveredCount, total: totalBefore, percentage };
      endpoints = uncovered;
    }

    if (endpoints.length === 0) {
      if (options.json) {
        printJson(jsonOk("guide", { fullyCovered: true, ...coverageInfo }));
      } else {
        console.log("All endpoints are covered.");
      }
      return 0;
    }

    if (options.tag) {
      endpoints = filterByTag(endpoints, options.tag);
      if (endpoints.length === 0) {
        const msg = `No endpoints found for tag "${options.tag}"`;
        if (options.json) printJson(jsonError("guide", [msg]));
        else printError(msg);
        return 1;
      }
    }

    const plan = planChunks(endpoints);

    if (plan.needsChunking && !options.tag) {
      if (options.json) {
        printJson(jsonOk("guide", {
          mode: "plan",
          title: title ?? "API",
          totalEndpoints: plan.totalEndpoints,
          chunks: plan.chunks,
          ...(coverageInfo ? { coverage: coverageInfo } : {}),
        }));
      } else {
        console.log(`API has ${plan.totalEndpoints} endpoints across ${plan.chunks.length} tags.`);
        console.log("Generate per-tag with --tag <name>:\n");
        for (const chunk of plan.chunks) {
          console.log(`  --tag ${chunk.tag} (${chunk.count} endpoints)`);
        }
      }
      return 0;
    }

    const coverageHeader = coverageInfo
      ? `## Coverage: ${coverageInfo.covered}/${coverageInfo.total} endpoints covered (${coverageInfo.percentage}%). Generating tests for ${endpoints.length} uncovered endpoints:`
      : undefined;

    const apiContext = compressEndpointsWithSchemas(endpoints, securitySchemes);
    const guide = buildGenerationGuide({
      title: options.tag ? `${title ?? "API"} — tag: ${options.tag}` : (title ?? "API"),
      baseUrl,
      apiContext,
      outputDir,
      securitySchemes,
      endpointCount: endpoints.length,
      coverageHeader,
      includeFormat: true,
    });

    if (options.json) {
      printJson(jsonOk("guide", {
        title: title ?? "API",
        endpointCount: endpoints.length,
        outputDir,
        guide,
        ...(coverageInfo ? { coverage: coverageInfo } : {}),
      }));
    } else {
      console.log(guide);
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("guide", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
