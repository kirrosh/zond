import { dirname, basename, join } from "path";
import { parse } from "../../core/parser/yaml-parser.ts";
import {
  buildCollection,
  buildEnvironment,
  deriveCollectionName,
} from "../../core/exporter/postman.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface ExportOptions {
  testsPath: string;
  output: string;
  env?: string;
  collectionName?: string;
  json?: boolean;
}

export async function exportCommand(options: ExportOptions): Promise<number> {
  // 1. Parse test suites
  let suites;
  try {
    suites = await parse(options.testsPath);
  } catch (err) {
    const msg = `Failed to parse tests: ${(err as Error).message}`;
    if (options.json) {
      printJson(jsonError("export postman", [msg]));
    } else {
      printError(msg);
    }
    return 2;
  }

  if (suites.length === 0) {
    const msg = "No test suites found";
    if (options.json) {
      printJson(jsonError("export postman", [msg]));
    } else {
      printError(msg);
    }
    return 1;
  }

  // 2. Derive collection name
  const collectionName =
    options.collectionName ?? deriveCollectionName(options.testsPath);

  // 3. Build collection
  const { collection, warnings } = buildCollection(suites, collectionName);

  // Count total items across all folders
  const totalItems = collection.item.reduce((sum, folder) => sum + folder.item.length, 0);

  // 4. Write collection file
  try {
    await Bun.write(options.output, JSON.stringify(collection, null, 2));
  } catch (err) {
    const msg = `Failed to write collection file: ${(err as Error).message}`;
    if (options.json) {
      printJson(jsonError("export postman", [msg], warnings));
    } else {
      printError(msg);
    }
    return 2;
  }

  // 5. Optional env export
  let envOutput: string | undefined;
  if (options.env) {
    let envVars: Record<string, string>;
    try {
      const text = await Bun.file(options.env).text();
      const parsed = Bun.YAML.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Environment file must be a YAML object");
      }
      // Convert all values to strings
      envVars = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        envVars[k] = String(v);
      }
    } catch (err) {
      const msg = `Failed to read env file: ${(err as Error).message}`;
      if (options.json) {
        printJson(jsonError("export postman", [msg], warnings));
      } else {
        printError(msg);
      }
      return 2;
    }

    // Derive env name: e.g. ".env.staging.yaml" → "staging", ".env.yaml" → collectionName
    const envBasename = basename(options.env);
    const envNameMatch = envBasename.match(/^\.?env\.(.+?)\.ya?ml$/);
    const envName = envNameMatch ? envNameMatch[1]! : collectionName;

    const environment = buildEnvironment(envVars, envName);

    // Output path: same directory as output, same base name with .postman_environment.json
    const outBase = basename(options.output).replace(/\.postman\.json$/, "").replace(/\.json$/, "");
    const outDir = dirname(options.output);
    envOutput = join(outDir, `${outBase}.postman_environment.json`);

    try {
      await Bun.write(envOutput, JSON.stringify(environment, null, 2));
    } catch (err) {
      const msg = `Failed to write environment file: ${(err as Error).message}`;
      if (options.json) {
        printJson(jsonError("export postman", [msg], warnings));
      } else {
        printError(msg);
      }
      return 2;
    }
  }

  // 6. Output result
  if (options.json) {
    printJson(
      jsonOk(
        "export postman",
        {
          output: options.output,
          suites: suites.length,
          items: totalItems,
          ...(envOutput !== undefined ? { envOutput } : {}),
        },
        warnings
      )
    );
  } else {
    for (const w of warnings) {
      printWarning(w);
    }
    printSuccess(
      `Exported ${suites.length} suite(s) / ${totalItems} request(s) → ${options.output}`
    );
    if (envOutput) {
      printSuccess(`Environment exported → ${envOutput}`);
    }
  }

  return 0;
}
