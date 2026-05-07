import { generateNegativeProbes } from "../../core/probe/negative-probe.ts";
import { loadSpecForProbe, writeProbeSuites } from "../../core/probe/runner.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

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
    const loaded = await loadSpecForProbe({
      specPath: options.specPath,
      tag: options.tag,
      listTags: options.listTags,
    });

    if (loaded.kind === "tags") {
      if (options.json) {
        printJson(jsonOk("probe-validation", { tags: loaded.tags }));
      } else if (loaded.tags.length === 0) {
        console.log("No tags found in spec.");
      } else {
        console.log("Available tags:");
        for (const t of loaded.tags) console.log(`  - ${t}`);
      }
      return 0;
    }

    if (loaded.kind === "tag-not-found") {
      const msg = `No endpoints tagged "${loaded.tag}". Available tags: ${loaded.available.length ? loaded.available.join(", ") : "(none)"}`;
      if (options.json) printJson(jsonError("probe-validation", [msg]));
      else printWarning(msg);
      return 2;
    }

    const { endpoints, securitySchemes } = loaded;
    if (endpoints.length === 0) {
      const message = "No endpoints to probe.";
      if (options.json) printJson(jsonOk("probe-validation", { files: [], message }));
      else console.log(message);
      return 0;
    }

    const result = generateNegativeProbes({
      endpoints,
      securitySchemes,
      maxProbesPerEndpoint: options.maxPerEndpoint,
      noCleanup: options.noCleanup,
      useRealParents: options.useRealParents,
    });

    const written = await writeProbeSuites({
      output: options.output,
      suites: result.suites,
      command: "zond probe-validation --emit",
      headerExample: `zond probe-validation --api <name> --output ${options.output}`,
    });

    if (options.json) {
      printJson(
        jsonOk("probe-validation", {
          files: written.files,
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
    if (options.json) printJson(jsonError("probe-validation", [message]));
    else printError(message);
    return 2;
  }
}
