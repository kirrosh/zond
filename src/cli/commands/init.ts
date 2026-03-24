import { setupApi } from "../../core/setup-api.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface InitOptions {
  name?: string;
  spec?: string;
  baseUrl?: string;
  dir?: string;
  force?: boolean;
  insecure?: boolean;
  dbPath?: string;
  json?: boolean;
}

export async function initCommand(options: InitOptions): Promise<number> {
  try {
    const envVars: Record<string, string> = {};
    if (options.baseUrl) envVars.base_url = options.baseUrl;

    const result = await setupApi({
      name: options.name,
      spec: options.spec,
      dir: options.dir,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      dbPath: options.dbPath,
      force: options.force,
      insecure: options.insecure,
    });

    if (options.json) {
      printJson(jsonOk("init", {
        collectionId: result.collectionId,
        baseDir: result.baseDir,
        testPath: result.testPath,
        endpoints: result.specEndpoints,
        warnings: result.warnings ?? [],
      }, result.warnings));
    } else {
      printSuccess(`Created API '${options.name ?? "api"}' at ${result.baseDir} (${result.specEndpoints} endpoints)`);
      if (result.warnings) {
        for (const w of result.warnings) {
          process.stderr.write(`Warning: ${w}\n`);
        }
      }
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("init", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
