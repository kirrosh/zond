import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { loadEnvironment, loadEnvFile } from "../../core/parser/variables.ts";
import {
  runMassAssignmentProbes,
  formatDigestMarkdown,
  emitRegressionSuites,
} from "../../core/probe/mass-assignment-probe.ts";
import { loadSpecForProbe, writeProbeSuites } from "../../core/probe/runner.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { getSecretRegistry } from "../../core/secrets/registry.ts";
import { applySanitizer } from "../../core/exporter/exporter.ts";
import { rotateOutputTarget } from "../../core/workspace/output-rotation.ts";
import { tallyBySeverity, formatSummaryLine } from "../../core/probe/verdict-aggregator.ts";

interface BucketCounts {
  high: number;
  inconclusiveBaseline: number;
  medium: number;
  low: number;
  ok: number;
  skipped: number;
}

const MA_BUCKETS: ReadonlyArray<readonly [string, keyof BucketCounts & string]> = [
  ["high", "high"],
  ["inconclusive-baseline", "inconclusiveBaseline"],
  ["medium", "medium"],
  ["low", "low"],
  ["ok", "ok"],
  ["skipped", "skipped"],
];

const MA_SUMMARY: ReadonlyArray<readonly [string, keyof BucketCounts & string]> = [
  ["HIGH", "high"],
  ["INCONCLUSIVE", "inconclusiveBaseline"],
  ["MED", "medium"],
  ["LOW", "low"],
  ["OK", "ok"],
  ["SKIPPED", "skipped"],
];

const MA_ZERO: BucketCounts = {
  high: 0, inconclusiveBaseline: 0, medium: 0, low: 0, ok: 0, skipped: 0,
};

export interface ProbeMassAssignmentOptions {
  specPath: string;
  env?: string;
  /** Markdown digest output file. If omitted — print to stdout. */
  output?: string;
  /** Emit regression YAML suites into this directory. */
  emitTests?: string;
  tag?: string;
  noCleanup?: boolean;
  noDiscover?: boolean;
  timeoutMs?: number;
  json?: boolean;
  listTags?: boolean;
  overwrite?: boolean;
}

export async function probeMassAssignmentCommand(
  options: ProbeMassAssignmentOptions,
): Promise<number> {
  try {
    const loaded = await loadSpecForProbe({
      specPath: options.specPath,
      tag: options.tag,
      listTags: options.listTags,
    });

    if (loaded.kind === "tags") {
      if (options.json) {
        printJson(jsonOk("probe-mass-assignment", { tags: loaded.tags }));
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
      if (options.json) printJson(jsonError("probe-mass-assignment", [msg]));
      else printWarning(msg);
      return 2;
    }
    const { endpoints, securitySchemes } = loaded;

    // Load env vars (base_url, auth_token, api_key, path-param overrides).
    let vars: Record<string, string> = {};
    if (options.env) {
      const fromFile = await loadEnvFile(options.env);
      if (!fromFile) {
        const msg = `Environment file not found: ${options.env}`;
        if (options.json) printJson(jsonError("probe-mass-assignment", [msg]));
        else printError(msg);
        return 2;
      }
      vars = fromFile;
    } else {
      vars = await loadEnvironment();
    }

    if (!vars["base_url"]) {
      const msg = "base_url is required (set in .env.yaml or via --env file). Probing requires a live API.";
      if (options.json) printJson(jsonError("probe-mass-assignment", [msg]));
      else printError(msg);
      return 2;
    }

    const result = await runMassAssignmentProbes({
      endpoints,
      securitySchemes,
      vars,
      noCleanup: options.noCleanup,
      timeoutMs: options.timeoutMs,
      discover: !options.noDiscover,
    });

    // TASK-168 (m-10): vars came from .env.yaml — register them so any
    // echoed token (URL, body, header) gets redacted in the digest.
    getSecretRegistry().registerAll(vars);
    const md = applySanitizer(formatDigestMarkdown(result, options.specPath));
    if (options.output) {
      await mkdir(join(options.output, "..").replace(/\/\.$/, ""), { recursive: true }).catch(() => {});
      // TASK-162 (m-9 P6): rotate previous digest to <stem>-vN.md instead
      // of silent overwrite. --overwrite opts back into the old behaviour.
      rotateOutputTarget(options.output, { overwrite: options.overwrite });
      await writeFile(options.output, md, "utf-8");
    }

    let emittedSuites: Array<{ file: string; suite: string; tests: number }> = [];
    if (options.emitTests) {
      const suites = emitRegressionSuites(result, endpoints, securitySchemes);
      const written = await writeProbeSuites({
        output: options.emitTests,
        suites,
        command: "zond probe-mass-assignment --emit-tests",
        headerExample: `zond probe-mass-assignment --api <name> --emit-tests ${options.emitTests}`,
      });
      emittedSuites = written.files;
    }

    const counts = tallyBySeverity(result.verdicts, MA_BUCKETS, MA_ZERO);

    if (options.json) {
      printJson(
        jsonOk("probe-mass-assignment", {
          digest: options.output ? { file: options.output } : { stdout: md },
          totalEndpoints: result.totalEndpoints,
          probed: result.specProbed,
          severity: counts,
          warnings: result.warnings,
          emittedTests: emittedSuites,
        }),
      );
    } else {
      if (!options.output) console.log(md);
      else printSuccess(`Digest written to ${options.output}`);
      console.log("");
      console.log(formatSummaryLine(counts, MA_SUMMARY));
      if (emittedSuites.length > 0) {
        printSuccess(`Emitted ${emittedSuites.length} regression suite(s) in ${options.emitTests}`);
        console.log(`  Run them on CI: zond run ${options.emitTests} --env ${options.env ?? ".env.yaml"}`);
      }
      if (counts.high > 0) {
        printWarning(`${counts.high} HIGH-severity finding(s) — privilege escalation candidates. Review the digest.`);
      }
      if (counts.inconclusiveBaseline > 0) {
        printWarning(
          `${counts.inconclusiveBaseline} endpoint(s) had baseline POST failures — fix env fixtures (FK ids / path-params) and re-run. These are excluded from --emit-tests on purpose.`,
        );
      }
    }

    // Non-zero exit when HIGH findings — useful for CI gating.
    return counts.high > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("probe-mass-assignment", [message]));
    else printError(message);
    return 2;
  }
}

