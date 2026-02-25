import { readOpenApiSpec, extractEndpoints, generateSkeleton, writeSuites } from "../../core/generator/index.ts";
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

    const suites = generateSkeleton(endpoints, baseUrl);
    console.log(`Generated ${suites.length} test suite(s)`);

    const files = await writeSuites(suites, options.output);
    for (const f of files) {
      printSuccess(`Written: ${f}`);
    }

    printSuccess(`Done! Generated ${files.length} file(s) in ${options.output}`);
    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
