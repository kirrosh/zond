import { join } from "path";
import { mkdir } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  serializeSuite,
} from "../../core/generator/index.ts";
import { filterByTag, collectTags } from "../../core/generator/chunker.ts";
import { generateNegativeProbes } from "../../core/probe/negative-probe.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { recordGeneratedFiles, inferApiName, autoGenHeader, type RecordInput } from "../../core/workspace/manifest.ts";

export interface ProbeValidationOptions {
  specPath: string;
  output: string;
  tag?: string;
  maxPerEndpoint?: number;
  noCleanup?: boolean;
  /**
   * TASK-135: when true (default), non-attacked path-params are emitted as
   * `{{name}}` runtime placeholders so `zond run` resolves them from
   * `.env.yaml`. When false, every param is baked as a synthetic sentinel,
   * which short-circuits to 404 on real APIs and hides nested-path 5xx bugs.
   */
  useRealParents?: boolean;
  json?: boolean;
  listTags?: boolean;
}

export async function probeValidationCommand(
  options: ProbeValidationOptions,
): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const allEndpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    if (options.listTags) {
      const tags = collectTags(allEndpoints);
      if (options.json) {
        printJson(jsonOk("probe-validation", { tags }));
      } else {
        if (tags.length === 0) {
          console.log("No tags found in spec.");
        } else {
          console.log("Available tags:");
          for (const t of tags) console.log(`  - ${t}`);
        }
      }
      return 0;
    }

    let endpoints = allEndpoints;
    if (options.tag) {
      endpoints = filterByTag(allEndpoints, options.tag);
      if (endpoints.length === 0) {
        const available = collectTags(allEndpoints);
        const msg = `No endpoints tagged "${options.tag}". Available tags: ${available.length ? available.join(", ") : "(none)"}`;
        if (options.json) {
          printJson(jsonError("probe-validation", [msg]));
        } else {
          printWarning(msg);
        }
        return 2;
      }
    }

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
      noCleanup: options.noCleanup,
      useRealParents: options.useRealParents,
    });

    await mkdir(options.output, { recursive: true });

    const created: Array<{ file: string; suite: string; tests: number }> = [];
    const manifestEntries: RecordInput[] = [];
    const inferredApi = inferApiName(options.output);
    for (const suite of result.suites) {
      const fileName = `${suite.fileStem ?? suite.name}.yaml`;
      const filePath = join(options.output, fileName);
      await Bun.write(filePath, autoGenHeader("zond probe-validation --emit", `zond probe-validation --api <name> --output ${options.output}`) + serializeSuite(suite));
      created.push({ file: filePath, suite: suite.name, tests: suite.tests.length });
      manifestEntries.push({
        path: filePath,
        by: "zond probe-validation --emit",
        api: inferredApi,
        category: "probes",
      });
    }

    try {
      const ws = findWorkspaceRoot();
      if (!ws.fromFallback && manifestEntries.length > 0) {
        recordGeneratedFiles(ws.root, manifestEntries);
      }
    } catch { /* best-effort */ }

    if (options.json) {
      printJson(
        jsonOk("probe-validation", {
          files: created,
          probedEndpoints: result.probedEndpoints,
          skippedEndpoints: result.skippedEndpoints,
          totalProbes: result.totalProbes,
          outputDir: options.output,
          warnings: result.warnings,
        }),
      );
    } else {
      printSuccess(
        `Generated ${result.suites.length} probe suite(s) with ${result.totalProbes} probe(s) in ${options.output}`,
      );
      console.log(
        `  ${result.probedEndpoints} endpoint(s) probed, ${result.skippedEndpoints} skipped (no probable surface)`,
      );
      for (const w of result.warnings) printWarning(w);
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
