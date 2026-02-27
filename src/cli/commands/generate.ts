import { resolve, basename } from "path";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes, generateSuites, writeSuites } from "../../core/generator/index.ts";
import { scanCoveredEndpoints, filterUncoveredEndpoints } from "../../core/generator/coverage-scanner.ts";
import { printError, printSuccess } from "../output.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByTestPath, createCollection, normalizePath } from "../../db/queries.ts";

export interface GenerateCommandOptions {
  from: string;
  output: string;
}

export async function generateCommand(options: GenerateCommandOptions): Promise<number> {
  try {
    console.log(`Reading OpenAPI spec: ${options.from}`);
    const doc = await readOpenApiSpec(options.from);

    let endpoints = extractEndpoints(doc);
    if (endpoints.length === 0) {
      printError("No endpoints found in the spec");
      return 2;
    }
    console.log(`Found ${endpoints.length} endpoint(s)`);

    // Extract base URL from servers[0] if available
    const baseUrl = (doc as any).servers?.[0]?.url as string | undefined;
    if (baseUrl) {
      console.log(`Base URL: ${baseUrl}`);
    }

    // Extract security schemes
    const securitySchemes = extractSecuritySchemes(doc);
    if (securitySchemes.length > 0) {
      console.log(`Found ${securitySchemes.length} security scheme(s): ${securitySchemes.map((s) => s.name).join(", ")}`);
    }

    // Incremental generation: scan existing coverage
    let coveredCount = 0;
    try {
      const { access } = await import("node:fs/promises");
      await access(options.output);
      // Output dir exists — scan for covered endpoints
      const covered = await scanCoveredEndpoints(options.output);
      coveredCount = covered.length;
      if (covered.length > 0) {
        const uncovered = filterUncoveredEndpoints(endpoints, covered);
        console.log(`${covered.length} of ${endpoints.length} endpoints already covered, generating ${uncovered.length} new`);
        if (uncovered.length === 0) {
          printSuccess("All endpoints covered, nothing to generate");
          return 0;
        }
        endpoints = uncovered;
      }
    } catch {
      // Output dir doesn't exist yet — generate everything
    }

    const suites = generateSuites(endpoints, baseUrl, securitySchemes);
    console.log(`Generated ${suites.length} test suite(s)`);

    const files = await writeSuites(suites, options.output);
    for (const f of files) {
      printSuccess(`Written: ${f}`);
    }

    if (files.length === 0 && coveredCount > 0) {
      printSuccess("All endpoints covered, no new files written");
    } else {
      printSuccess(`Done! Generated ${files.length} file(s) in ${options.output}`);
    }

    // Auto-create collection
    try {
      getDb();
      const normalizedOutput = normalizePath(options.output);
      const existing = findCollectionByTestPath(normalizedOutput);
      if (!existing) {
        const specName = (doc as any).info?.title ?? basename(options.from);
        const collId = createCollection({
          name: specName,
          test_path: normalizedOutput,
          openapi_spec: resolve(options.from),
        });
        printSuccess(`Created collection "${specName}" (id: ${collId})`);
      }
    } catch {
      // DB not critical for generate
    }

    // Print hint about auth env vars if bearer auth was detected
    const hasBearerAuth = securitySchemes.some((s) => s.type === "http" && s.scheme === "bearer");
    if (hasBearerAuth) {
      console.log(`\nHint: Set auth_username and auth_password in your .env.yaml file:`);
      console.log(`  auth_username: admin`);
      console.log(`  auth_password: admin`);
    }

    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
