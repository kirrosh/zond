import { setupApi } from "../../core/setup-api.ts";
import { printError, printSuccess } from "../output.ts";

export interface AddApiOptions {
  name: string;
  spec?: string;
  dir?: string;
  envPairs?: string[];
  dbPath?: string;
  insecure?: boolean;
}

export async function addApiCommand(options: AddApiOptions): Promise<number> {
  const { name, spec, envPairs, dbPath, dir, insecure } = options;

  // Parse --env key=value pairs into a record
  const envVars: Record<string, string> = {};
  if (envPairs) {
    for (const pair of envPairs) {
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key) envVars[key] = value;
    }
  }

  try {
    const result = await setupApi({
      name,
      spec,
      dir,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
      dbPath,
      insecure,
    });

    printSuccess(`API '${name}' created (id=${result.collectionId})`);
    console.log(`  Directory: ${result.testPath.replace(/\/tests$/, "")}`);
    console.log(`  Tests:     ${result.testPath}/`);
    if (spec) console.log(`  Spec:      ${spec}`);
    if (result.baseUrl) console.log(`  Base URL:  ${result.baseUrl}`);
    console.log();
    console.log("Next steps:");
    console.log(`  zond ai-generate --api ${name} --prompt "test the user endpoints"`);
    console.log(`  zond run --api ${name}`);

    return 0;
  } catch (err) {
    printError((err as Error).message);
    return 1;
  }
}
