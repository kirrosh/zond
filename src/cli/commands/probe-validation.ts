import { join } from "path";
import { mkdir } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  serializeSuite,
} from "../../core/generator/index.ts";
import { filterByTag } from "../../core/generator/chunker.ts";
import { generateNegativeProbes } from "../../core/probe/negative-probe.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface ProbeValidationOptions {
  specPath: string;
  output: string;
  tag?: string;
  maxPerEndpoint?: number;
  json?: boolean;
}

export async function probeValidationCommand(
  options: ProbeValidationOptions,
): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    let endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    if (options.tag) endpoints = filterByTag(endpoints, options.tag);

    if (endpoints.length === 0) {
      const message = "No endpoints to probe.";
      if (options.json) {
        printJson(jsonOk("probe-validation", { files: [], message }));
      } else {
        console.log(message);
      }
      return 0;
    }

    const result = generateNegativeProbes({
      endpoints,
      securitySchemes,
      maxProbesPerEndpoint: options.maxPerEndpoint,
    });

    await mkdir(options.output, { recursive: true });

    const created: Array<{ file: string; suite: string; tests: number }> = [];
    for (const suite of result.suites) {
      const fileName = `${suite.fileStem ?? suite.name}.yaml`;
      const filePath = join(options.output, fileName);
      await Bun.write(filePath, serializeSuite(suite));
      created.push({ file: filePath, suite: suite.name, tests: suite.tests.length });
    }

    if (options.json) {
      printJson(
        jsonOk("probe-validation", {
          files: created,
          probedEndpoints: result.probedEndpoints,
          skippedEndpoints: result.skippedEndpoints,
          totalProbes: result.totalProbes,
          outputDir: options.output,
        }),
      );
    } else {
      printSuccess(
        `Generated ${result.suites.length} probe suite(s) with ${result.totalProbes} probe(s) in ${options.output}`,
      );
      console.log(
        `  ${result.probedEndpoints} endpoint(s) probed, ${result.skippedEndpoints} skipped (no probable surface)`,
      );
      console.log("");
      console.log("Next steps:");
      console.log(`  zond run ${options.output} --report json   # any 5xx → bug candidate`);
      console.log(`  zond db diagnose <run-id>                  # inspect failures`);
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("probe-validation", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
