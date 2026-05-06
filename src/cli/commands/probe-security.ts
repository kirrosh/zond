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
  runSecurityProbes,
  formatSecurityDigest,
  emitSecurityRegressionSuites,
  SECURITY_CLASSES,
  type SecurityClass,
  type SecuritySeverity,
} from "../../core/probe/security-probe.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { recordGeneratedFiles, inferApiName, autoGenHeader, type RecordInput } from "../../core/workspace/manifest.ts";

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

    const doc = await readOpenApiSpec(options.specPath);
    const allEndpoints = extractEndpoints(doc);
    const securitySchemes = extractSecuritySchemes(doc);

    if (options.listTags) {
      const tags = collectTags(allEndpoints);
      if (options.json) printJson(jsonOk("probe-security", { tags }));
      else {
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
        if (options.json) printJson(jsonError("probe-security", [msg]));
        else printWarning(msg);
        return 2;
      }
    }

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

    const result = await runSecurityProbes({
      endpoints,
      securitySchemes,
      vars,
      classes,
      noCleanup: options.noCleanup,
      timeoutMs: options.timeoutMs,
      dryRun: options.dryRun,
    });

    const md = formatSecurityDigest(result, options.specPath);
    if (options.output) {
      await mkdir(join(options.output, "..").replace(/\/\.$/, ""), { recursive: true }).catch(() => {});
      await writeFile(options.output, md, "utf-8");
    }

    let emittedSuites: Array<{ file: string; suite: string; tests: number }> = [];
    if (options.emitTests && !options.dryRun) {
      const suites = emitSecurityRegressionSuites(result, endpoints, securitySchemes);
      const manifestEntries: RecordInput[] = [];
      const inferredApi = inferApiName(options.emitTests);
      // m-9 P5: do not create empty --emit-tests/ directories.
      if (suites.length > 0) await mkdir(options.emitTests, { recursive: true });
      for (const suite of suites) {
        const file = join(options.emitTests, `${suite.fileStem ?? suite.name}.yaml`);
        await Bun.write(file, autoGenHeader("zond probe-security --emit-tests", `zond probe-security --api <name> --emit-tests ${options.emitTests}`) + serializeSuite(suite));
        emittedSuites.push({ file, suite: suite.name, tests: suite.tests.length });
        manifestEntries.push({
          path: file,
          by: "zond probe-security --emit-tests",
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
    }

    const counts = countBuckets(result.verdicts);

    if (options.json) {
      printJson(
        jsonOk("probe-security", {
          digest: options.output ? { file: options.output } : { stdout: md },
          totalEndpoints: result.totalEndpoints,
          probed: result.specProbed,
          severity: counts,
          emittedTests: emittedSuites,
        }),
      );
    } else {
      if (!options.output) console.log(md);
      else printSuccess(`Digest written to ${options.output}`);
      console.log("");
      console.log(
        `Summary: HIGH ${counts.high} · INCONCLUSIVE ${counts.inconclusive} · INCONCLUSIVE-BASE ${counts.inconclusiveBaseline} · LOW ${counts.low} · OK ${counts.ok} · SKIPPED ${counts.skipped}`,
      );
      if (emittedSuites.length > 0) {
        printSuccess(`Emitted ${emittedSuites.length} regression suite(s) in ${options.emitTests}`);
      }
      if (counts.high > 0) {
        printWarning(`${counts.high} HIGH-severity finding(s) — review the digest before deploy.`);
      }
    }

    const cleanupFailures = result.verdicts.filter(v => v.cleanup?.error).length;
    if (cleanupFailures > 0 && !options.json) {
      printWarning(
        `${cleanupFailures} endpoint(s) with cleanup failures — see "Cleanup failures" section in the digest. Manual remediation may be required.`,
      );
    }

    // Exit non-zero on HIGH (CI gate) or cleanup failures (data
    // integrity). Cleanup failure means probe-security mutated state
    // it couldn't restore — the operator needs to act.
    return counts.high > 0 || cleanupFailures > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("probe-security", [message]));
    else printError(message);
    return 2;
  }
}

interface Buckets {
  high: number;
  low: number;
  inconclusive: number;
  inconclusiveBaseline: number;
  ok: number;
  skipped: number;
}

function countBuckets(verdicts: Array<{ severity: SecuritySeverity }>): Buckets {
  const out: Buckets = { high: 0, low: 0, inconclusive: 0, inconclusiveBaseline: 0, ok: 0, skipped: 0 };
  for (const v of verdicts) {
    switch (v.severity) {
      case "high": out.high++; break;
      case "low": out.low++; break;
      case "inconclusive": out.inconclusive++; break;
      case "inconclusive-baseline": out.inconclusiveBaseline++; break;
      case "ok": out.ok++; break;
      case "skipped": out.skipped++; break;
    }
  }
  return out;
}
