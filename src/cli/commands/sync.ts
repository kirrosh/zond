import { join } from "path";
import { mkdir } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  serializeSuite,
  buildCatalog,
  serializeCatalog,
} from "../../core/generator/index.ts";
import { generateSuites } from "../../core/generator/suite-generator.ts";
import { filterByTag } from "../../core/generator/chunker.ts";
import { readMeta, writeMeta, hashSpec, buildFileMeta } from "../../core/meta/meta-store.ts";
import { diffEndpoints } from "../../core/sync/spec-differ.ts";
import { decycleSchema } from "../../core/generator/schema-utils.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { version as ZOND_VERSION } from "../../../package.json";
import { getDb } from "../../db/schema.ts";
import { findCollectionByTestPath, updateCollection } from "../../db/queries.ts";

export interface SyncOptions {
  specPath: string;
  testsDir: string;
  dryRun?: boolean;
  tag?: string;
  json?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<number> {
  try {
    // Load existing metadata
    const meta = await readMeta(options.testsDir);
    if (!meta) {
      const msg =
        "No .zond-meta.json found. Run `zond generate <spec> --output <dir>` first to initialize metadata.";
      if (options.json) {
        printJson(jsonError("sync", [msg]));
      } else {
        printError(msg);
      }
      return 2;
    }

    // Load current spec
    const doc = await readOpenApiSpec(options.specPath);
    const specContent = JSON.stringify(decycleSchema(doc));
    const currentHash = hashSpec(specContent);

    if (currentHash === meta.specHash) {
      const msg = "Spec unchanged — nothing to sync.";
      if (options.json) {
        printJson(jsonOk("sync", { newEndpoints: [], generatedFiles: [], removedKeys: [], specChanged: false }, [msg]));
      } else {
        console.log(msg);
      }
      return 0;
    }

    // Extract current endpoints
    let currentEndpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    if (options.tag) {
      currentEndpoints = filterByTag(currentEndpoints, options.tag);
    }

    // Collect all previously known endpoint keys from meta
    const prevKeys = Object.values(meta.files).flatMap((f) => f.endpoints);

    // Compute diff
    const { newEndpoints, removedKeys } = diffEndpoints(prevKeys, currentEndpoints);

    const warnings: string[] = [];

    if (removedKeys.length > 0) {
      for (const key of removedKeys) {
        warnings.push(`Removed endpoint not deleted from tests (review manually): ${key}`);
      }
    }

    if (newEndpoints.length === 0) {
      // Update catalog even when no new endpoints — spec schema may have changed
      const allEndpoints = extractEndpoints(doc);
      const catalog = buildCatalog({
        endpoints: allEndpoints,
        securitySchemes,
        specSource: options.specPath,
        specHash: currentHash,
        apiName: (doc as any).info?.title,
        apiVersion: (doc as any).info?.version,
        baseUrl: (doc as any).servers?.[0]?.url,
      });
      await Bun.write(join(options.testsDir, ".api-catalog.yaml"), serializeCatalog(catalog));

      const msg = "Spec changed (hash differs) but no new endpoints detected. Existing tests may need manual review.";
      warnings.push(msg);
      if (options.json) {
        printJson(jsonOk("sync", {
          newEndpoints: [],
          removedKeys,
          generatedFiles: [],
          specChanged: true,
        }, warnings));
      } else {
        console.log(msg);
        for (const w of warnings) {
          printWarning(w);
        }
      }
      return 0;
    }

    // Generate suites for new endpoints only
    const suites = generateSuites({ endpoints: newEndpoints, securitySchemes, specPath: options.specPath });

    if (options.dryRun) {
      const newEndpointKeys = newEndpoints.map((ep) => `${ep.method.toUpperCase()} ${ep.path}`);
      const plannedFiles = suites.map((s) => ({
        file: `${s.fileStem ?? s.name}.yaml`,
        suite: s.name,
        tests: s.tests.length,
      }));

      if (options.json) {
        printJson(jsonOk("sync", {
          dryRun: true,
          newEndpoints: newEndpointKeys,
          removedKeys,
          plannedFiles,
          specChanged: true,
        }, warnings));
      } else {
        console.log(`[dry-run] Detected ${newEndpoints.length} new endpoint(s):`);
        for (const ep of newEndpoints) {
          console.log(`  + ${ep.method.toUpperCase()} ${ep.path}`);
        }
        console.log(`\nWould generate ${suites.length} new suite file(s):`);
        for (const f of plannedFiles) {
          console.log(`  ${f.file}  (${f.tests} tests)`);
        }
        if (removedKeys.length > 0) {
          console.log("\nRemoved endpoints (not deleted — review tests):");
          for (const key of removedKeys) {
            console.log(`  - ${key}`);
          }
        }
        console.log("\nNo files written (dry-run).");
      }
      return 0;
    }

    // Write new files (skip if file already exists)
    await mkdir(options.testsDir, { recursive: true });

    const generatedFiles: Array<{ file: string; suite: string; tests: number }> = [];
    const skippedFiles: string[] = [];
    const updatedMetaFiles: Record<string, import("../../core/meta/types.ts").FileMeta> = {};

    for (const suite of suites) {
      const fileName = `${suite.fileStem ?? suite.name}.yaml`;
      const filePath = join(options.testsDir, fileName);
      const existing = Bun.file(filePath);

      if (await existing.exists()) {
        skippedFiles.push(fileName);
        warnings.push(`Skipped ${fileName} (already exists — add new endpoints manually)`);
        continue;
      }

      const yaml = serializeSuite(suite);
      await Bun.write(filePath, yaml);
      generatedFiles.push({ file: filePath, suite: suite.name, tests: suite.tests.length });
      updatedMetaFiles[fileName] = buildFileMeta(suite, ZOND_VERSION);
    }

    // Update metadata: merge new file entries, update hash and timestamp
    await writeMeta(options.testsDir, {
      zondVersion: ZOND_VERSION,
      lastSyncedAt: new Date().toISOString(),
      specHash: currentHash,
      files: { ...meta.files, ...updatedMetaFiles },
    });

    // Update .api-catalog.yaml with current spec state
    const allEndpoints = extractEndpoints(doc);
    const catalog = buildCatalog({
      endpoints: allEndpoints,
      securitySchemes,
      specSource: options.specPath,
      specHash: currentHash,
      apiName: (doc as any).info?.title,
      apiVersion: (doc as any).info?.version,
      baseUrl: (doc as any).servers?.[0]?.url,
    });
    await Bun.write(join(options.testsDir, ".api-catalog.yaml"), serializeCatalog(catalog));

    // Sync DB collection if one is registered for this tests directory
    try {
      getDb();
      const collection = findCollectionByTestPath(options.testsDir);
      if (collection && collection.openapi_spec !== options.specPath) {
        updateCollection(collection.id, { openapi_spec: options.specPath });
        warnings.push(`Updated collection '${collection.name}' spec reference: ${collection.openapi_spec ?? "(none)"} → ${options.specPath}`);
      }
    } catch {
      // DB unavailable (e.g. no zond.db yet) — not a fatal error for sync
    }

    const newEndpointKeys = newEndpoints.map((ep) => `${ep.method.toUpperCase()} ${ep.path}`);

    if (options.json) {
      printJson(jsonOk("sync", {
        newEndpoints: newEndpointKeys,
        removedKeys,
        generatedFiles,
        skippedFiles,
        specChanged: true,
      }, warnings));
    } else {
      console.log(`Spec changed. Detected ${newEndpoints.length} new endpoint(s):`);
      for (const ep of newEndpoints) {
        console.log(`  + ${ep.method.toUpperCase()} ${ep.path}`);
      }

      if (generatedFiles.length > 0) {
        console.log(`\nGenerated ${generatedFiles.length} new suite file(s):`);
        for (const f of generatedFiles) {
          console.log(`  ${f.file}  (${f.tests} tests)`);
        }
      }

      if (skippedFiles.length > 0) {
        console.log("\nSkipped (file exists, review manually):");
        for (const f of skippedFiles) {
          console.log(`  ${f}`);
        }
      }

      if (removedKeys.length > 0) {
        console.log("\nRemoved endpoints (not deleted — review tests):");
        for (const key of removedKeys) {
          console.log(`  - ${key}`);
        }
      }

      if (generatedFiles.length > 0) {
        printSuccess(`\nSync complete. ${generatedFiles.length} file(s) written.`);
      } else {
        printWarning("No new files written — all target files already exist.");
      }

      for (const w of warnings) {
        printWarning(w);
      }
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("sync", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
