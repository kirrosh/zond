import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { loadEnvironment, loadEnvFile } from "../../core/parser/variables.ts";
import {
  runSecurityProbes,
  formatSecurityDigest,
  emitSecurityRegressionSuites,
  SECURITY_CLASSES,
  type SecurityClass,
} from "../../core/probe/security-probe.ts";
import { loadSpecForProbe, writeProbeSuites } from "../../core/probe/runner.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { getSecretRegistry } from "../../core/secrets/registry.ts";
import { applySanitizer } from "../../core/exporter/exporter.ts";
import { rotateOutputTarget } from "../../core/workspace/output-rotation.ts";
import { tallyBySeverity, formatSummaryLine } from "../../core/probe/verdict-aggregator.ts";
import { printMutationBanner, countCleanupFailures } from "../../core/probe/shared.ts";

interface Buckets {
  high: number;
  low: number;
  inconclusive: number;
  inconclusiveBaseline: number;
  ok: number;
  skipped: number;
}

const SEC_BUCKETS: ReadonlyArray<readonly [string, keyof Buckets & string]> = [
  ["high", "high"],
  ["low", "low"],
  ["inconclusive", "inconclusive"],
  ["inconclusive-baseline", "inconclusiveBaseline"],
  ["ok", "ok"],
  ["skipped", "skipped"],
];

const SEC_SUMMARY: ReadonlyArray<readonly [string, keyof Buckets & string]> = [
  ["HIGH", "high"],
  ["INCONCLUSIVE", "inconclusive"],
  ["INCONCLUSIVE-BASE", "inconclusiveBaseline"],
  ["LOW", "low"],
  ["OK", "ok"],
  ["SKIPPED", "skipped"],
];

const SEC_ZERO: Buckets = {
  high: 0, low: 0, inconclusive: 0, inconclusiveBaseline: 0, ok: 0, skipped: 0,
};

export interface ProbeSecurityOptions {
  specPath: string;
  classes: string;
  env?: string;
  output?: string;
  emitTests?: string;
  tag?: string;
  noCleanup?: boolean;
  timeoutMs?: number;
  dryRun?: boolean;
  json?: boolean;
  listTags?: boolean;
  overwrite?: boolean;
}

function parseClasses(input: string): SecurityClass[] | string {
  const parts = input.split(",").map(s => s.trim()).filter(Boolean);
  const out: SecurityClass[] = [];
  for (const p of parts) {
    if (!(SECURITY_CLASSES as readonly string[]).includes(p)) {
      return `Unknown class: ${p}. Available: ${SECURITY_CLASSES.join(", ")}`;
    }
    out.push(p as SecurityClass);
  }
  if (out.length === 0) return `At least one class required (${SECURITY_CLASSES.join(", ")})`;
  return out;
}

export async function probeSecurityCommand(
  options: ProbeSecurityOptions,
): Promise<number> {
  try {
    const classes = parseClasses(options.classes);
    if (typeof classes === "string") {
      if (options.json) printJson(jsonError("probe-security", [classes]));
      else printError(classes);
      return 2;
    }

    const loaded = await loadSpecForProbe({
      specPath: options.specPath,
      tag: options.tag,
      listTags: options.listTags,
    });

    if (loaded.kind === "tags") {
      if (options.json) printJson(jsonOk("probe-security", { tags: loaded.tags }));
      else if (loaded.tags.length === 0) console.log("No tags found in spec.");
      else {
        console.log("Available tags:");
        for (const t of loaded.tags) console.log(`  - ${t}`);
      }
      return 0;
    }
    if (loaded.kind === "tag-not-found") {
      const msg = `No endpoints tagged "${loaded.tag}". Available tags: ${loaded.available.length ? loaded.available.join(", ") : "(none)"}`;
      if (options.json) printJson(jsonError("probe-security", [msg]));
      else printWarning(msg);
      return 2;
    }
    const { endpoints, securitySchemes } = loaded;

    let vars: Record<string, string> = {};
    if (options.env) {
      const fromFile = await loadEnvFile(options.env);
      if (!fromFile) {
        const msg = `Environment file not found: ${options.env}`;
        if (options.json) printJson(jsonError("probe-security", [msg]));
        else printError(msg);
        return 2;
      }
      vars = fromFile;
    } else {
      vars = await loadEnvironment();
    }

    if (!options.dryRun && !vars["base_url"]) {
      const msg = "base_url is required (set in .env.yaml or via --env file). Probing requires a live API.";
      if (options.json) printJson(jsonError("probe-security", [msg]));
      else printError(msg);
      return 2;
    }

    // TASK-259: live security probes mutate via PUT/PATCH/POST + cleanup
    // DELETE. Skip the banner in --dry-run (no live calls) and --json (warnings
    // travel in the envelope instead).
    if (!options.dryRun) {
      printMutationBanner("probe-security", vars, { quiet: options.json === true });
    }

    const result = await runSecurityProbes({
      endpoints,
      securitySchemes,
      vars,
      classes,
      noCleanup: options.noCleanup,
      timeoutMs: options.timeoutMs,
      dryRun: options.dryRun,
    });

    // TASK-168 (m-10): register env vars + redact the digest before
    // either writing to disk or echoing to stdout.
    getSecretRegistry().registerAll(vars);
    const md = applySanitizer(formatSecurityDigest(result, options.specPath));
    if (options.output) {
      await mkdir(join(options.output, "..").replace(/\/\.$/, ""), { recursive: true }).catch(() => {});
      rotateOutputTarget(options.output, { overwrite: options.overwrite });
      await writeFile(options.output, md, "utf-8");
    }

    let emittedSuites: Array<{ file: string; suite: string; tests: number }> = [];
    if (options.emitTests && !options.dryRun) {
      const suites = emitSecurityRegressionSuites(result, endpoints, securitySchemes);
      const written = await writeProbeSuites({
        output: options.emitTests,
        suites,
        command: "zond probe-security --emit-tests",
        headerExample: `zond probe-security --api <name> --emit-tests ${options.emitTests}`,
      });
      emittedSuites = written.files;
    }

    const counts = tallyBySeverity(result.verdicts, SEC_BUCKETS, SEC_ZERO);
    // TASK-259: shared cleanup-failure counter (404 treated as success — the
    // resource is already gone, which is the cleanup goal). Replaces the
    // previous local filter that flagged any `cleanup.error` regardless of
    // the underlying status.
    const orphans = countCleanupFailures(result.verdicts);

    if (options.json) {
      printJson(
        jsonOk("probe-security", {
          digest: options.output ? { file: options.output } : { stdout: md },
          totalEndpoints: result.totalEndpoints,
          probed: result.specProbed,
          severity: counts,
          orphans,
          emittedTests: emittedSuites,
        }),
      );
    } else {
      if (!options.output) console.log(md);
      else printSuccess(`Digest written to ${options.output}`);
      console.log("");
      console.log(formatSummaryLine(counts, SEC_SUMMARY));
      if (emittedSuites.length > 0) {
        printSuccess(`Emitted ${emittedSuites.length} regression suite(s) in ${options.emitTests}`);
      } else if (options.emitTests && !options.dryRun) {
        console.log(`No 2xx findings to emit. Directory ${options.emitTests} not created.`);
      }
      if (counts.high > 0) {
        printWarning(`${counts.high} HIGH-severity finding(s) — review the digest before deploy.`);
      }
      if (orphans > 0) {
        printWarning(
          `${orphans} orphan resource(s): cleanup DELETE failed (non-404). Manual remediation may be needed — see digest.`,
        );
      }
      const cleanedCount = result.verdicts.filter(v => v.cleanup?.attempted && v.cleanup.status != null && v.cleanup.status < 400).length;
      if (cleanedCount > 0) {
        printWarning(
          `${cleanedCount} resource(s) created and deleted by probes. FK fixtures in .env.yaml may be stale — re-run \`zond discover --api <name>\` before next CRUD run.`,
        );
      }
    }

    // Exit non-zero on HIGH (CI gate) or cleanup failures (data
    // integrity). Cleanup failure means probe-security mutated state
    // it couldn't restore — the operator needs to act.
    return counts.high > 0 || orphans > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("probe-security", [message]));
    else printError(message);
    return 2;
  }
}

