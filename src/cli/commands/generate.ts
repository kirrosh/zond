import { readOpenApiSpec, extractEndpoints, extractSecuritySchemes, generateSkeleton, writeSuites } from "../../core/generator/index.ts";
import { printError, printSuccess } from "../output.ts";

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

    const suites = generateSkeleton(endpoints, baseUrl, securitySchemes);
    console.log(`Generated ${suites.length} test suite(s)`);

    const files = await writeSuites(suites, options.output);
    for (const f of files) {
      printSuccess(`Written: ${f}`);
    }

    printSuccess(`Done! Generated ${files.length} file(s) in ${options.output}`);

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
