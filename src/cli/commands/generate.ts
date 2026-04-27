import { join, dirname } from "path";
import { mkdir } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  scanCoveredEndpoints,
  filterUncoveredEndpoints,
  serializeSuite,
  buildCatalog,
  serializeCatalog,
} from "../../core/generator/index.ts";
import { generateSuites, findUnresolvedVars } from "../../core/generator/suite-generator.ts";
import { filterByTag } from "../../core/generator/chunker.ts";
import { parse } from "../../core/parser/yaml-parser.ts";
import { decycleSchema } from "../../core/generator/schema-utils.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { readMeta, writeMeta, hashSpec, buildFileMeta } from "../../core/meta/meta-store.ts";
import { version as ZOND_VERSION } from "../../../package.json";
import { getDb } from "../../db/schema.ts";
import { findCollectionByTestPath, updateCollection } from "../../db/queries.ts";

export interface GenerateOptions {
  specPath: string;
  output: string;
  tag?: string;
  uncoveredOnly?: boolean;
  json?: boolean;
}

export async function generateCommand(options: GenerateOptions): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const allEndpoints = extractEndpoints(doc);
    let endpoints = allEndpoints;
    const securitySchemes = extractSecuritySchemes(doc);
    const baseUrl = ((doc as any).servers?.[0]?.url) as string | undefined;
    const apiName = (doc as any).info?.title as string | undefined;
    const apiVersion = (doc as any).info?.version as string | undefined;
    const warnings: string[] = [];

    // Filter to uncovered only
    if (options.uncoveredOnly) {
      const covered = await scanCoveredEndpoints(options.output);
      const before = endpoints.length;
      endpoints = filterUncoveredEndpoints(endpoints, covered);
      const coveredCount = before - endpoints.length;
      if (coveredCount > 0) {
        warnings.push(`Skipped ${coveredCount} already-covered endpoints`);
      }
    }

    // Filter by tag
    if (options.tag) {
      endpoints = filterByTag(endpoints, options.tag);
    }

    if (endpoints.length === 0) {
      if (options.json) {
        printJson(jsonOk("generate", { files: [], message: "No endpoints to generate tests for" }, warnings));
      } else {
        console.log("No endpoints to generate tests for.");
      }
      return 0;
    }

    // Generate suites
    const suites = generateSuites({ endpoints, securitySchemes });

    // Ensure output directory exists
    await mkdir(options.output, { recursive: true });

    // Write suite files
    const createdFiles: Array<{ file: string; suite: string; tests: number }> = [];

    // Build metadata for written files
    const metaFiles: Record<string, import("../../core/meta/types.ts").FileMeta> = {};

    for (const suite of suites) {
      const yaml = serializeSuite(suite);
      const fileName = `${suite.fileStem ?? suite.name}.yaml`;
      const filePath = join(options.output, fileName);
      await Bun.write(filePath, yaml);
      createdFiles.push({ file: filePath, suite: suite.name, tests: suite.tests.length });
      metaFiles[fileName] = buildFileMeta(suite, ZOND_VERSION);
    }

    // Write .zond-meta.json (merge with existing meta to preserve info about prior files)
    const existingMeta = await readMeta(options.output);
    const specContent = typeof doc === "object" ? JSON.stringify(decycleSchema(doc)) : String(doc);
    await writeMeta(options.output, {
      zondVersion: ZOND_VERSION,
      lastSyncedAt: new Date().toISOString(),
      specHash: hashSpec(specContent),
      files: { ...(existingMeta?.files ?? {}), ...metaFiles },
    });

    // Generate .api-catalog.yaml (always uses full unfiltered endpoint list)
    const catalog = buildCatalog({
      endpoints: allEndpoints,
      securitySchemes,
      specSource: options.specPath,
      specHash: hashSpec(specContent),
      apiName,
      apiVersion,
      baseUrl,
    });
    await Bun.write(join(options.output, ".api-catalog.yaml"), serializeCatalog(catalog));

    // Sync DB collection spec reference if one is registered for this output directory
    try {
      getDb();
      const collection = findCollectionByTestPath(options.output);
      if (collection && collection.openapi_spec !== options.specPath) {
        updateCollection(collection.id, { openapi_spec: options.specPath });
        warnings.push(`Updated collection '${collection.name}' spec reference → ${options.specPath}`);
      }
    } catch {
      // DB unavailable — not fatal
    }

    // Create .env.yaml with base_url and unresolved variables as placeholders
    const envPath = join(options.output, ".env.yaml");
    const envFile = Bun.file(envPath);
    if (!(await envFile.exists())) {
      const unresolvedVars = new Set<string>();
      for (const suite of suites) {
        for (const v of findUnresolvedVars(suite)) unresolvedVars.add(v);
      }
      const lines: string[] = [];
      if (baseUrl) lines.push(`base_url: ${baseUrl}`);
      for (const v of [...unresolvedVars].sort()) {
        lines.push(`${v}: "" # TODO: fill in`);
      }
      if (lines.length > 0) {
        await Bun.write(envPath, lines.join("\n") + "\n");
        warnings.push(`Created ${envPath} with ${unresolvedVars.size} placeholder variable(s)`);
      }
    }

    // Validate generated files
    const validationErrors: string[] = [];
    try {
      await parse(options.output);
    } catch (err) {
      validationErrors.push(err instanceof Error ? err.message : String(err));
    }

    if (validationErrors.length > 0) {
      warnings.push(`Validation warnings: ${validationErrors.join("; ")}`);
    }

    // Output
    const totalTests = createdFiles.reduce((sum, f) => sum + f.tests, 0);

    if (options.json) {
      printJson(jsonOk("generate", {
        files: createdFiles,
        totalSuites: suites.length,
        totalTests,
        outputDir: options.output,
      }, warnings));
    } else {
      printSuccess(`Generated ${suites.length} suite(s) with ${totalTests} test(s) in ${options.output}`);
      for (const f of createdFiles) {
        console.log(`  ${f.file} (${f.tests} tests)`);
      }
      if (warnings.length > 0) {
        for (const w of warnings) {
          console.log(`  ⚠ ${w}`);
        }
      }
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("generate", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
