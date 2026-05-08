/**
 * `zond probe by-bogus-id` — emit one negative-coverage suite per
 * parameterized path (TASK-275). Pairs with `coverage --union tag:` from
 * TASK-274 so the negative hits roll into the same coverage view as the
 * positive CRUD suite.
 */
import { generateNegativeByIdProbes } from "../../core/probe/negative-by-id-probe.ts";
import { loadSpecForProbe, writeProbeSuites } from "../../core/probe/runner.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface ProbeByBogusIdOptions {
  specPath: string;
  output: string;
  tag?: string;
  json?: boolean;
  listTags?: boolean;
}

export async function probeByBogusIdCommand(
  options: ProbeByBogusIdOptions,
): Promise<number> {
  try {
    const loaded = await loadSpecForProbe({
      specPath: options.specPath,
      tag: options.tag,
      listTags: options.listTags,
    });
    if (loaded.kind === "tag-not-found") {
      const msg = `No endpoints tagged "${loaded.tag}". Available tags: ${loaded.available.length ? loaded.available.join(", ") : "(none)"}`;
      if (options.json) printJson(jsonError("probe-by-bogus-id", [msg]));
      else printError(msg);
      return 2;
    }
    if (loaded.kind === "tags") {
      if (options.json) printJson(jsonOk("probe-by-bogus-id", { tags: loaded.tags }));
      else for (const t of loaded.tags) console.log(`  - ${t}`);
      return 0;
    }

    const { endpoints, securitySchemes } = loaded;
    if (endpoints.length === 0) {
      const message = "No endpoints to probe.";
      if (options.json) printJson(jsonOk("probe-by-bogus-id", { files: [], message }));
      else console.log(message);
      return 0;
    }

    const result = generateNegativeByIdProbes({ endpoints, securitySchemes });

    if (result.suites.length === 0) {
      const message =
        "No parameterized paths found — every endpoint is a collection/LIST. Nothing to probe by bogus id.";
      if (options.json) {
        printJson(
          jsonOk("probe-by-bogus-id", {
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

    const written = await writeProbeSuites({
      output: options.output,
      suites: result.suites,
      command: "zond probe by-bogus-id --emit",
      headerExample: `zond probe by-bogus-id --api <name> --output ${options.output}`,
    });

    if (options.json) {
      printJson(
        jsonOk("probe-by-bogus-id", {
          files: written.files,
          probedPaths: result.probedPaths,
          skippedPaths: result.skippedPaths,
          totalProbes: result.totalProbes,
          outputDir: options.output,
        }),
      );
    } else {
      printSuccess(
        `Generated ${result.suites.length} negative-by-id suite(s) with ${result.totalProbes} probe(s) in ${options.output}`,
      );
      console.log(
        `  ${result.probedPaths} parameterized path(s) probed, ${result.skippedPaths} skipped (no path params — collection endpoints)`,
      );
      console.log("");
      console.log("Next steps:");
      console.log(`  zond run ${options.output} --report json   # any 5xx or 2xx → bug candidate`);
      console.log(`  zond coverage --union tag:negative-by-id    # roll into combined coverage`);
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("probe-by-bogus-id", [message]));
    else printError(message);
    return 2;
  }
}
