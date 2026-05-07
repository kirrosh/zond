import { generateMethodProbes } from "../../core/probe/method-probe.ts";
import { loadSpecForProbe, writeProbeSuites } from "../../core/probe/runner.ts";
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
    const loaded = await loadSpecForProbe({ specPath: options.specPath, tag: options.tag });
    if (loaded.kind === "tag-not-found") {
      const msg = `No endpoints tagged "${loaded.tag}". Available tags: ${loaded.available.length ? loaded.available.join(", ") : "(none)"}`;
      if (options.json) printJson(jsonError("probe-methods", [msg]));
      else printError(msg);
      return 2;
    }
    if (loaded.kind === "tags") {
      if (options.json) printJson(jsonOk("probe-methods", { tags: loaded.tags }));
      else for (const t of loaded.tags) console.log(`  - ${t}`);
      return 0;
    }

    const { endpoints, securitySchemes } = loaded;
    if (endpoints.length === 0) {
      const message = "No endpoints to probe.";
      if (options.json) printJson(jsonOk("probe-methods", { files: [], message }));
      else console.log(message);
      return 0;
    }

    const result = generateMethodProbes({ endpoints, securitySchemes });

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

    const written = await writeProbeSuites({
      output: options.output,
      suites: result.suites,
      command: "zond probe-methods --emit",
      headerExample: `zond probe-methods --api <name> --output ${options.output}`,
    });

    if (options.json) {
      printJson(
        jsonOk("probe-methods", {
          files: written.files,
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
    if (options.json) printJson(jsonError("probe-methods", [message]));
    else printError(message);
    return 2;
  }
}
