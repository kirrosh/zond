import { resolve, basename } from "path";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes, generateSuites, writeSuites } from "../../core/generator/index.ts";
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

    const endpoints = extractEndpoints(doc);
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

    const suites = generateSuites(endpoints, baseUrl, securitySchemes);
    console.log(`Generated ${suites.length} test suite(s)`);

    const files = await writeSuites(suites, options.output);
    for (const f of files) {
      printSuccess(`Written: ${f}`);
    }

    printSuccess(`Done! Generated ${files.length} file(s) in ${options.output}`);

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
