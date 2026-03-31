import { join } from "path";
import { mkdir } from "fs/promises";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes } from "../../core/generator/index.ts";
import { buildCatalog, serializeCatalog } from "../../core/generator/catalog-builder.ts";
import { decycleSchema } from "../../core/generator/schema-utils.ts";
import { hashSpec } from "../../core/meta/meta-store.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface CatalogOptions {
  specPath: string;
  output?: string;
  json?: boolean;
}

export async function catalogCommand(options: CatalogOptions): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);
    const baseUrl = ((doc as any).servers?.[0]?.url) as string | undefined;
    const apiName = (doc as any).info?.title as string | undefined;
    const apiVersion = (doc as any).info?.version as string | undefined;
    const specContent = JSON.stringify(decycleSchema(doc));

    const catalog = buildCatalog({
      endpoints,
      securitySchemes,
      specSource: options.specPath,
      specHash: hashSpec(specContent),
      apiName,
      apiVersion,
      baseUrl,
    });

    const outputDir = options.output ?? ".";
    await mkdir(outputDir, { recursive: true });

    const catalogPath = join(outputDir, ".api-catalog.yaml");
    await Bun.write(catalogPath, serializeCatalog(catalog));

    if (options.json) {
      printJson(jsonOk("catalog", {
        path: catalogPath,
        endpointCount: catalog.endpointCount,
        apiName: catalog.apiName,
      }));
    } else {
      printSuccess(`Generated API catalog: ${catalogPath} (${catalog.endpointCount} endpoints)`);
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("catalog", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
