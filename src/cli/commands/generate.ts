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
import {
  generateSuites,
  findUnresolvedVars,
  detectCrudGroupsWithDiagnostics,
} from "../../core/generator/suite-generator.ts";
import { filterByTag } from "../../core/generator/chunker.ts";
import { parse } from "../../core/parser/yaml-parser.ts";
import { decycleSchema } from "../../core/generator/schema-utils.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { hashSpec } from "../../core/meta/meta-store.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByTestPath, updateCollection } from "../../db/queries.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { recordGeneratedFiles, inferApiName, autoGenHeader, type RecordInput } from "../../core/workspace/manifest.ts";

export interface GenerateOptions {
  specPath: string;
  output: string;
  tag?: string;
  uncoveredOnly?: boolean;
  /** TASK-139: dry-run that prints per-resource CRUD detection verdict and
   *  exits — no files written. Use to debug "why didn't generate emit a
   *  CRUD chain for resource X?" on real specs. */
  explain?: boolean;
  json?: boolean;
}

export async function generateCommand(options: GenerateOptions): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const allEndpoints = extractEndpoints(doc);
    let endpoints = allEndpoints;
    const securitySchemes = extractSecuritySchemes(doc);

    // --explain short-circuits: print the CRUD detection table and exit.
    if (options.explain) {
      let scope = endpoints;
      if (options.tag) scope = filterByTag(scope, options.tag);
      const { groups, diagnostics } = detectCrudGroupsWithDiagnostics(scope);
      if (options.json) {
        printJson(jsonOk("generate", {
          mode: "explain",
          totalCandidates: diagnostics.length,
          chains: groups.length,
          diagnostics,
        }));
      } else {
        if (diagnostics.length === 0) {
          console.log("No POST endpoints in scope — nothing to evaluate.");
        } else {
          const chains = diagnostics.filter(d => d.verdict === "chain").length;
          console.log(`CRUD detection: ${chains}/${diagnostics.length} POST endpoints became chain candidates.\n`);
          const headers = ["resource", "post", "get/{id}", "put/patch", "delete", "list", "verdict", "reason"];
          const rows = diagnostics.map(d => [
            d.resource,
            d.postPath,
            d.hasGetById ? "✓" : "—",
            d.hasUpdate ? "✓" : "—",
            d.hasDelete ? "✓" : "—",
            d.hasList ? "✓" : "—",
            d.verdict,
            d.reason,
          ]);
          const widths = headers.map((h, i) =>
            Math.max(h.length, ...rows.map(r => r[i]!.length)),
          );
          const fmt = (cells: string[]) =>
            cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
          console.log(fmt(headers));
          console.log(widths.map(w => "─".repeat(w)).join("  "));
          for (const row of rows) console.log(fmt(row));
        }
      }
      return 0;
    }
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
    const suites = generateSuites({ endpoints, securitySchemes, specPath: options.specPath });

    // Ensure output directory exists
    await mkdir(options.output, { recursive: true });

    // Write suite files
    const createdFiles: Array<{ file: string; suite: string; tests: number }> = [];
    const manifestEntries: RecordInput[] = [];
    const inferredApi = inferApiName(options.output);

    for (const suite of suites) {
      const yaml = serializeSuite(suite);
      const fileName = `${suite.fileStem ?? suite.name}.yaml`;
      const filePath = join(options.output, fileName);
      const header = autoGenHeader("zond generate", `zond generate --api <name> --output ${options.output}`);
      await Bun.write(filePath, header + yaml);
      createdFiles.push({ file: filePath, suite: suite.name, tests: suite.tests.length });
      manifestEntries.push({
        path: filePath,
        by: "zond generate",
        api: inferredApi,
        category: "tests",
      });
    }

    const specContent = typeof doc === "object" ? JSON.stringify(decycleSchema(doc)) : String(doc);

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
    const catalogPath = join(options.output, ".api-catalog.yaml");
    await Bun.write(catalogPath, serializeCatalog(catalog));
    manifestEntries.push({
      path: catalogPath,
      by: "zond generate",
      api: inferredApi,
      category: "catalog",
    });

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
        manifestEntries.push({
          path: envPath,
          by: "zond generate",
          api: inferredApi,
          category: "env",
        });
      }
    }

    // Record everything we wrote into .zond/manifest.json (TASK-156).
    try {
      const ws = findWorkspaceRoot();
      if (!ws.fromFallback && manifestEntries.length > 0) {
        recordGeneratedFiles(ws.root, manifestEntries);
      }
    } catch {
      // Manifest is best-effort; never fail the generate command on it.
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
      console.log("");
      console.log("Next steps:");
      console.log("  1. Fill apis/<name>/.env.yaml with auth_token, real FK ids, verified emails, valid enums");
      console.log("     (the fixture pack — without it, {{$randomString}} loses 5+ iterations to format-validation)");
      console.log("  2. zond run <output> --safe --json                              # smoke (GET-only)");
      console.log(`  3. zond run <output> --tag crud,setup --validate-schema --spec ${options.specPath} --json`);
      console.log("     (--validate-schema catches contract drift; recommended for every CRUD run)");
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
