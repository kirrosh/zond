import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  serializeSuite,
} from "../../core/generator/index.ts";
import { filterByTag, collectTags } from "../../core/generator/chunker.ts";
import { loadEnvironment, loadEnvFile } from "../../core/parser/variables.ts";
import {
  runMassAssignmentProbes,
  formatDigestMarkdown,
  emitRegressionSuites,
} from "../../core/probe/mass-assignment-probe.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

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
}

export async function probeMassAssignmentCommand(
  options: ProbeMassAssignmentOptions,
): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const allEndpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    if (options.listTags) {
      const tags = collectTags(allEndpoints);
      if (options.json) {
        printJson(jsonOk("probe-mass-assignment", { tags }));
      } else {
        if (tags.length === 0) console.log("No tags found in spec.");
        else {
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
        if (options.json) printJson(jsonError("probe-mass-assignment", [msg]));
        else printWarning(msg);
        return 2;
      }
    }

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

    const md = formatDigestMarkdown(result, options.specPath);
    if (options.output) {
      await mkdir(join(options.output, "..").replace(/\/\.$/, ""), { recursive: true }).catch(() => {});
      await writeFile(options.output, md, "utf-8");
    }

    let emittedSuites: Array<{ file: string; suite: string; tests: number }> = [];
    if (options.emitTests) {
      const suites = emitRegressionSuites(result, endpoints, securitySchemes);
      await mkdir(options.emitTests, { recursive: true });
      for (const suite of suites) {
        const file = join(options.emitTests, `${suite.fileStem ?? suite.name}.yaml`);
        await Bun.write(file, serializeSuite(suite));
        emittedSuites.push({ file, suite: suite.name, tests: suite.tests.length });
      }
    }

    const counts = countBuckets(result.verdicts);

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
      printSeverityLine(counts);
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

interface BucketCounts {
  high: number;
  inconclusiveBaseline: number;
  medium: number;
  low: number;
  ok: number;
  skipped: number;
}

function countBuckets(verdicts: Array<{ severity: string }>): BucketCounts {
  const out: BucketCounts = {
    high: 0,
    inconclusiveBaseline: 0,
    medium: 0,
    low: 0,
    ok: 0,
    skipped: 0,
  };
  for (const v of verdicts) {
    switch (v.severity) {
      case "high": out.high++; break;
      case "inconclusive-baseline": out.inconclusiveBaseline++; break;
      case "medium": out.medium++; break;
      case "low": out.low++; break;
      case "ok": out.ok++; break;
      case "skipped": out.skipped++; break;
    }
  }
  return out;
}

function printSeverityLine(c: BucketCounts): void {
  console.log(
    `Summary: HIGH ${c.high} · INCONCLUSIVE ${c.inconclusiveBaseline} · MED ${c.medium} · LOW ${c.low} · OK ${c.ok} · SKIPPED ${c.skipped}`,
  );
}
