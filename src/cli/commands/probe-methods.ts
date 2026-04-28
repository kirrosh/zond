import { join } from "path";
import { mkdir } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  serializeSuite,
} from "../../core/generator/index.ts";
import { filterByTag } from "../../core/generator/chunker.ts";
import { generateMethodProbes } from "../../core/probe/method-probe.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface ProbeMethodsOptions {
  specPath: string;
  output: string;
  tag?: string;
  json?: boolean;
}

export async function probeMethodsCommand(
  options: ProbeMethodsOptions,
): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    let endpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    if (options.tag) endpoints = filterByTag(endpoints, options.tag);

    if (endpoints.length === 0) {
      const message = "No endpoints to probe.";
      if (options.json) {
        printJson(jsonOk("probe-methods", { files: [], message }));
      } else {
        console.log(message);
      }
      return 0;
    }

    const result = generateMethodProbes({
      endpoints,
      securitySchemes,
    });

    if (result.suites.length === 0) {
      const message =
        "Every path declares all of GET/POST/PUT/PATCH/DELETE — nothing to probe.";
      if (options.json) {
        printJson(
          jsonOk("probe-methods", {
            files: [],
            probedPaths: 0,
            skippedPaths: result.skippedPaths,
            totalProbes: 0,
            message,
          }),
        );
      } else {
        console.log(message);
      }
      return 0;
    }

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
        jsonOk("probe-methods", {
          files: created,
          probedPaths: result.probedPaths,
          skippedPaths: result.skippedPaths,
          totalProbes: result.totalProbes,
          outputDir: options.output,
        }),
      );
    } else {
      printSuccess(
        `Generated ${result.suites.length} method-probe suite(s) with ${result.totalProbes} probe(s) in ${options.output}`,
      );
      console.log(
        `  ${result.probedPaths} path(s) probed, ${result.skippedPaths} skipped (full method coverage)`,
      );
      console.log("");
      console.log("Next steps:");
      console.log(`  zond run ${options.output} --report json   # any 5xx or 2xx → bug candidate`);
      console.log(`  zond db diagnose <run-id>                  # inspect failures`);
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("probe-methods", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
