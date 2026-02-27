import { resolve, basename } from "path";
import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes, generateSuites, writeSuites, isRelativeUrl, sanitizeEnvName } from "../../core/generator/index.ts";
import { scanCoveredEndpoints, filterUncoveredEndpoints } from "../../core/generator/coverage-scanner.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByTestPath, createCollection, normalizePath, upsertEnvironment } from "../../db/queries.ts";
import type { EndpointInfo, SecuritySchemeInfo } from "../../core/generator/types.ts";

export interface GenerateCommandOptions {
  from: string;
  output: string;
  authToken?: string;
  envName?: string;
  dbPath?: string;
  noWizard?: boolean;
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

    // Extract base URL from servers[0] if available
    let baseUrl = (doc as any).servers?.[0]?.url as string | undefined;

    // Extract security schemes
    const securitySchemes = extractSecuritySchemes(doc);

    // Spec metadata
    const specName = (doc as any).info?.title ?? basename(options.from);

    // Count methods
    const methodCounts = countMethods(endpoints);

    console.log(`Found ${endpoints.length} endpoint(s) (GET: ${methodCounts.GET}, POST: ${methodCounts.POST}, PUT: ${methodCounts.PUT}, PATCH: ${methodCounts.PATCH}, DELETE: ${methodCounts.DELETE})`);

    if (baseUrl) {
      console.log(`Base URL: ${baseUrl}`);
    }
    if (securitySchemes.length > 0) {
      console.log(`Found ${securitySchemes.length} security scheme(s): ${securitySchemes.map((s) => s.name).join(", ")}`);
    }

    // Interactive wizard (TTY only, unless --no-wizard)
    let authToken = options.authToken;
    let envName = options.envName;

    if (process.stdin.isTTY && !options.noWizard) {
      const wizardResult = await runWizard(baseUrl, securitySchemes, specName, authToken, envName);
      if (wizardResult.baseUrl !== undefined) baseUrl = wizardResult.baseUrl;
      if (wizardResult.authToken !== undefined) authToken = wizardResult.authToken;
      if (wizardResult.envName !== undefined) envName = wizardResult.envName;
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

    // Auto-create collection + save environment to DB
    try {
      getDb(options.dbPath);
      const normalizedOutput = normalizePath(options.output);
      const existing = findCollectionByTestPath(normalizedOutput);
      if (!existing) {
        const collId = createCollection({
          name: specName,
          test_path: normalizedOutput,
          openapi_spec: resolve(options.from),
        });
        printSuccess(`Created collection "${specName}" (id: ${collId})`);
      }

      // Build environment variables
      const resolvedEnvName = envName ?? sanitizeEnvName(specName);
      const envVars: Record<string, string> = {};

      // Add base_url if relative
      if (baseUrl && isRelativeUrl(baseUrl)) {
        envVars.base_url = baseUrl;
      } else if (baseUrl) {
        envVars.base_url = baseUrl;
      }

      // Add auth token
      if (authToken) {
        envVars.auth_token = authToken;
      }

      // Detect auth schemes and add placeholders
      const hasBearerAuth = securitySchemes.some(s => s.type === "http" && s.scheme === "bearer");
      if (hasBearerAuth && !authToken) {
        envVars.auth_username = "admin";
        envVars.auth_password = "admin";
      }

      const apiKeySchemes = securitySchemes.filter(s => s.type === "apiKey");
      for (const apiKey of apiKeySchemes) {
        const varName = apiKey.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        envVars[varName] = `YOUR_${varName.toUpperCase()}`;
      }

      if (Object.keys(envVars).length > 0) {
        upsertEnvironment(resolvedEnvName, envVars);
        const varNames = Object.keys(envVars).join(", ");
        printSuccess(`Saved environment "${resolvedEnvName}" (${varNames})`);
      }
    } catch {
      // DB not critical for generate
    }

    // Count destructive tests and show warnings
    const destructiveCount = methodCounts.POST + methodCounts.PUT + methodCounts.PATCH + methodCounts.DELETE;
    if (destructiveCount > 0) {
      const resolvedEnvName = envName ?? sanitizeEnvName(specName);
      printWarning(`${destructiveCount} destructive tests (POST/PUT/PATCH/DELETE) — may modify real data.`);
      console.log(`Run safe (GET only):  apitool run ${options.output} --env ${resolvedEnvName} --safe`);
      console.log(`Run all:              apitool run ${options.output} --env ${resolvedEnvName}`);
    }

    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

function countMethods(endpoints: EndpointInfo[]): { GET: number; POST: number; PUT: number; PATCH: number; DELETE: number } {
  const counts = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 };
  for (const ep of endpoints) {
    const method = ep.method.toUpperCase() as keyof typeof counts;
    if (method in counts) counts[method]++;
  }
  return counts;
}

interface WizardResult {
  baseUrl?: string;
  authToken?: string;
  envName?: string;
}

async function runWizard(
  baseUrl: string | undefined,
  securitySchemes: SecuritySchemeInfo[],
  specName: string,
  existingAuthToken?: string,
  existingEnvName?: string,
): Promise<WizardResult> {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

  const result: WizardResult = {};

  try {
    // Prompt for base URL if relative
    if (baseUrl && isRelativeUrl(baseUrl)) {
      const answer = await ask(`Base URL is relative (${baseUrl}). Enter full URL (or Enter to use placeholder): `);
      if (answer.trim()) {
        result.baseUrl = answer.trim();
      }
    }

    // Prompt for auth token if bearer auth detected
    const hasBearerAuth = securitySchemes.some(s => s.type === "http" && s.scheme === "bearer");
    if (hasBearerAuth && !existingAuthToken) {
      const answer = await ask("Bearer auth detected. Enter auth token (Enter to skip): ");
      if (answer.trim()) {
        result.authToken = answer.trim();
      }
    }

    // Prompt for env name
    const defaultEnvName = existingEnvName ?? sanitizeEnvName(specName);
    const answer = await ask(`Environment name [${defaultEnvName}]: `);
    result.envName = answer.trim() || defaultEnvName;
  } finally {
    rl.close();
  }

  return result;
}
