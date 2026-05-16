import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { loadEnvironment, loadEnvFile } from "../../../core/parser/variables.ts";
import {
  runSecurityProbes,
  formatSecurityDigest,
  emitSecurityRegressionSuites,
  SECURITY_CLASSES,
  type SecurityClass,
} from "../../../core/probe/security-probe.ts";
import { loadSpecForProbe, writeProbeSuites } from "../../../core/probe/runner.ts";
import { printError, printSuccess, printWarning } from "../../output.ts";
import { jsonOk, jsonError, printJson } from "../../json-envelope.ts";
import { getSecretRegistry } from "../../../core/secrets/registry.ts";
import { applySanitizer } from "../../../core/exporter/exporter.ts";
import { rotateOutputTarget } from "../../../core/workspace/output-rotation.ts";
import { tallyBySeverity, formatSummaryLine } from "../../../core/probe/verdict-aggregator.ts";
import { printMutationBanner, countCleanupFailures } from "../../../core/probe/shared.ts";
import { persistVerdictsAsOrphans } from "../../../core/probe/orphan-tracker.ts";
import { SecurityProbe } from "../../../core/probe/security-probe-class.ts";
import { summarizeDryRun } from "../../../core/probe/dry-run-envelope.ts";
import { compileOperationFilter } from "../../../core/selectors/operation-filter.ts";

interface Buckets {
  high: number;
  medium: number;
  low: number;
  info: number;
  inconclusive: number;
  inconclusiveBaseline: number;
  ok: number;
  skipped: number;
}

const SEC_BUCKETS: ReadonlyArray<readonly [string, keyof Buckets & string]> = [
  ["high", "high"],
  ["medium", "medium"],
  ["low", "low"],
  ["info", "info"],
  ["inconclusive", "inconclusive"],
  ["inconclusive-baseline", "inconclusiveBaseline"],
  ["ok", "ok"],
  ["skipped", "skipped"],
];

const SEC_SUMMARY: ReadonlyArray<readonly [string, keyof Buckets & string]> = [
  ["HIGH", "high"],
  ["INCONCLUSIVE", "inconclusive"],
  ["INCONCLUSIVE-BASE", "inconclusiveBaseline"],
  ["MED", "medium"],
  ["LOW", "low"],
  ["INFO", "info"],
  ["OK", "ok"],
  ["SKIPPED", "skipped"],
];

const SEC_ZERO: Buckets = {
  high: 0, medium: 0, low: 0, info: 0, inconclusive: 0, inconclusiveBaseline: 0, ok: 0, skipped: 0,
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
  /** TASK-278: API name for orphan-tracker file path
   *  (`~/.zond/orphans/<api>/<run-id>.jsonl`). Defaults to "default" when
   *  the probe is invoked without --api. */
  apiName?: string;
  /** TASK-264: refuse to attack PUT/PATCH endpoints whose path-params come
   *  from `.env.yaml` (seeded fixtures). Trade coverage for guaranteed
   *  fixture safety. */
  isolated?: boolean;
  /** ARV-140: opt-in to POST attacks on endpoints with no DELETE counterpart
   *  in the spec. Defaults to off so probes can't leak resources the CLI
   *  has no way to clean up afterwards. */
  allowLeaks?: boolean;
  /** m-17 / ARV-51: structured report format for `--output` and the
   *  non-`--json` stdout path. `--json` envelope is always structured
   *  (no markdown blob) regardless of this flag. Default: "markdown" so
   *  human invocations keep the existing behaviour. */
  report?: "markdown" | "json";
  /** m-15 ARV-9 / m-17 ARV-J: unified operation selectors. */
  include?: string[];
  exclude?: string[];
  /** ARV-253: surface INFO-severity findings (CRLF accepted, no
   *  reflection — sanitization signal only). Hidden by default since
   *  they carry single_signal proof with no exploit pathway. */
  verbose?: boolean;
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
    const { endpoints: rawEndpoints, securitySchemes } = loaded;

    // m-17 / ARV-J: unified --include/--exclude (m-15 ARV-9). Closes
    // ARV-9 AC#3 for probe-family.
    let endpoints = rawEndpoints;
    if (options.include?.length || options.exclude?.length) {
      const compiled = compileOperationFilter({ includes: options.include, excludes: options.exclude });
      if (compiled.errors.length > 0) {
        const message = compiled.errors.join("\n");
        if (options.json) printJson(jsonError("probe-security", [message]));
        else printError(message);
        return 2;
      }
      endpoints = endpoints.filter(compiled.filter);
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

    // m-17 / ARV-50: dry-run answers "what would I attack" — severity is
    // undefined here, so we use a separate `data.endpoints[]` shape with
    // explicit `planned: boolean` and `skip_reason` enum. The previous
    // conflation (severity.skipped == 32, which silently included 14
    // planned attacks) is what made `severity.skipped == totalEndpoints`
    // a misleading CI gate (F1-15).
    if (options.dryRun) {
      const probe = new SecurityProbe();
      const plan = await probe.dryRun({
        specPath: options.specPath,
        endpoints,
        securitySchemes,
        vars,
        classes,
        options: { isolated: options.isolated === true },
      });
      const data = summarizeDryRun(plan);
      if (options.json) {
        printJson(jsonOk("probe-security", data));
      } else {
        const { formatDryRunDigest } = await import("../../../core/probe/dry-run-envelope.ts");
        console.log(formatDryRunDigest(plan));
      }
      return 0;
    }

    // TASK-259: live security probes mutate via PUT/PATCH/POST + cleanup
    // DELETE. Skip the banner in --dry-run (no live calls) and --json (warnings
    // travel in the envelope instead).
    printMutationBanner("probe-security", vars, { quiet: options.json === true });

    const result = await runSecurityProbes({
      endpoints,
      securitySchemes,
      vars,
      classes,
      noCleanup: options.noCleanup,
      timeoutMs: options.timeoutMs,
      dryRun: options.dryRun,
      isolated: options.isolated === true,
      allowLeaks: options.allowLeaks === true,
    });

    // ARV-253: filter verdicts for display under the evidence-chain
    // principle. INFO-severity findings (CRLF accepted, no reflection
    // — sanitization signal only) are hidden by default; surfaced under
    // --verbose for hygiene auditors. JSON envelope keeps the unfiltered
    // list so agents can opt in explicitly.
    const displayResult = options.verbose === true
      ? result
      : { ...result, verdicts: result.verdicts.map((v) => ({
          ...v,
          findings: v.findings.filter((f) => f.severity !== "info"),
        })) };

    // TASK-168 (m-10): register env vars + redact the digest before
    // either writing to disk or echoing to stdout.
    getSecretRegistry().registerAll(vars);
    const md = applySanitizer(formatSecurityDigest(displayResult, options.specPath));

    // m-17 / ARV-51: --output writes whichever format `--report` selected
    // (default markdown). `--json` envelope is always structured —
    // never carries `data.digest.stdout` (F3-15).
    const reportFmt: "markdown" | "json" = options.report ?? "markdown";
    const structuredEndpoints = buildStructuredEndpoints(result);
    if (options.output) {
      await mkdir(join(options.output, "..").replace(/\/\.$/, ""), { recursive: true }).catch(() => {});
      rotateOutputTarget(options.output, { overwrite: options.overwrite });
      const payload = reportFmt === "json"
        ? JSON.stringify(structuredReport(result, structuredEndpoints), null, 2) + "\n"
        : md;
      await writeFile(options.output, payload, "utf-8");
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

    // TASK-278: persist created-resource records to ~/.zond/orphans/<api>/<run-id>.jsonl
    // even when cleanup succeeded — successful entries become tombstones that
    // suppress the leak; failed ones are picked up by `zond cleanup --orphans`.
    const orphanRunId = `${Date.now()}`;
    const orphanApi = options.apiName ?? "default";
    if (!options.dryRun) {
      try {
        await persistVerdictsAsOrphans(orphanApi, orphanRunId, result.verdicts);
      } catch (err) {
        // Non-fatal — orphan tracking is a hygiene aid, not a probe blocker.
        if (!options.json) {
          process.stderr.write(`zond: failed to persist orphan tracker: ${(err as Error).message}\n`);
        }
      }
    }
    const orphanList = result.verdicts
      .filter(v => {
        const c = v.cleanup;
        if (!c?.attempted || c.id === undefined) return false;
        if (c.error) return true;
        return c.status != null && c.status >= 400 && c.status !== 404;
      })
      .map(v => ({
        method: v.method.toUpperCase(),
        path: v.path,
        id: String(v.cleanup!.id),
        deletePath: v.cleanup!.deletePath ?? "",
        lastStatus: v.cleanup!.status ?? null,
        error: v.cleanup!.error ?? null,
      }));

    if (options.json) {
      // m-17 / ARV-51: structured envelope. `data.digest.stdout` is gone
      // (F3-15) — markdown lives in `--output <file>` or `--report markdown`
      // on the non-json path. Severity becomes summary.by_status.
      printJson(
        jsonOk("probe-security", {
          endpoints: structuredEndpoints,
          summary: {
            totalEndpoints: result.totalEndpoints,
            probed: result.specProbed,
            by_status: byStatus(structuredEndpoints),
            // ARV-140: pre-flight cleanup-feasibility counts. Lets CI gate on
            // "no leak-prone POSTs slipped in" independently of HIGH findings.
            ...(result.cleanupFeasibility ? {
              cleanup_feasibility: {
                skipped_no_cleanup: result.cleanupFeasibility.skippedNoCleanup,
                forced_no_cleanup: result.cleanupFeasibility.forcedNoCleanup,
                // ARV-153: action POSTs attacked even without a DELETE
                // counterpart (e.g. /capture, /verify, /cancel).
                action_no_cleanup_needed: result.cleanupFeasibility.actionNoCleanupNeeded,
              },
            } : {}),
          },
          orphans,
          emittedTests: emittedSuites,
        }),
      );
    } else {
      if (!options.output) {
        if (reportFmt === "json") {
          process.stdout.write(JSON.stringify(structuredReport(result, structuredEndpoints), null, 2) + "\n");
        } else {
          console.log(md);
        }
      } else printSuccess(`${reportFmt === "json" ? "Structured report" : "Digest"} written to ${options.output}`);
      console.log("");
      console.log(formatSummaryLine(counts, SEC_SUMMARY));
      if (emittedSuites.length > 0) {
        printSuccess(`Emitted ${emittedSuites.length} regression suite(s) in ${options.emitTests}`);
        // TASK-154 §M: print one ready-to-paste command that re-runs the
        // emitted suites against the same API. Keeps the CI handoff short
        // (issue body / runbook entry: copy this line, not three).
        const envFlag = options.apiName ? ` --env apis/${options.apiName}/.env.yaml` : "";
        console.log(`Run regression suite on CI: zond run ${options.emitTests}${envFlag}`);
      } else if (options.emitTests && !options.dryRun) {
        console.log(`No 2xx findings to emit. Directory ${options.emitTests} not created.`);
      }
      if (counts.high > 0) {
        printWarning(`${counts.high} HIGH-severity finding(s) — review the digest before deploy.`);
      }
      if (orphans > 0) {
        printWarning(
          `${orphans} orphan resource(s): cleanup DELETE failed (non-404). Manual remediation may be needed.`,
        );
        // TASK-278: list each orphan with id + deletePath so the operator can
        // see what's leaked without grep'ing the digest.
        if (orphanList.length > 0) {
          for (const o of orphanList) {
            const tail = o.lastStatus != null ? `→ ${o.lastStatus}` : (o.error ? `→ err: ${o.error.split(" | ")[0]}` : "");
            process.stderr.write(`  ${o.method} ${o.path} (id=${o.id}); DELETE ${o.deletePath} ${tail}\n`);
          }
          process.stderr.write(`Run \`zond cleanup --orphans --api ${orphanApi}\` to retry.\n`);
        }
      }
      const cleanedCount = result.verdicts.filter(v => v.cleanup?.attempted && v.cleanup.status != null && v.cleanup.status < 400).length;
      if (cleanedCount > 0) {
        printWarning(
          `${cleanedCount} resource(s) created and deleted by probes. FK fixtures in .env.yaml may be stale — re-run \`zond prepare-fixtures --api <name>\` before next CRUD run.`,
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

// m-17 / ARV-51: structured per-endpoint shape used by both the `--json`
// envelope and the non-json `--report json` path. Mirrors the Probe
// contract result (src/core/probe/types.ts), but built from the legacy
// SecurityVerdict[] so the live runner keeps emitting its richer
// internal structure.

import type { SecurityProbeResult, SecurityVerdict } from "../../../core/probe/security-probe.ts";
import type { ProbeEndpointResult, ProbeEndpointStatus, ProbeFindingSeverity } from "../../../core/probe/types.ts";

function statusFromSeverity(s: SecurityVerdict["severity"]): ProbeEndpointStatus {
  if (s === "high") return "high";
  if (s === "low") return "low";
  if (s === "ok") return "ok";
  if (s === "skipped") return "skipped";
  return "inconclusive";
}

function findingSeverity(s: string): ProbeFindingSeverity {
  if (s === "high") return "high";
  if (s === "low") return "low";
  if (s === "ok") return "ok";
  return "inconclusive";
}

function buildStructuredEndpoints(result: SecurityProbeResult): ProbeEndpointResult[] {
  return result.verdicts.map((v) => ({
    path: v.path,
    method: v.method,
    classes_run: Array.from(new Set(v.detectedFields.map((d) => d.class))),
    findings: v.findings.map((f) => ({
      class: f.class,
      severity: findingSeverity(f.severity),
      evidence: {
        field: f.field,
        payload: f.payload,
        status: f.status,
        echoed: f.echoed,
        reason: f.reason,
        ...(f.recommended_action ? { recommended_action: f.recommended_action } : {}),
      },
    })),
    status: statusFromSeverity(v.severity),
    ...(v.skipReason ? { skip_reason: v.skipReason } : {}),
  }));
}

function byStatus(endpoints: ProbeEndpointResult[]): Record<ProbeEndpointStatus, number> {
  const out: Record<ProbeEndpointStatus, number> = {
    ok: 0, high: 0, low: 0, inconclusive: 0, skipped: 0,
  };
  for (const e of endpoints) out[e.status]++;
  return out;
}

function structuredReport(result: SecurityProbeResult, endpoints: ProbeEndpointResult[]): object {
  return {
    endpoints,
    summary: {
      totalEndpoints: result.totalEndpoints,
      probed: result.specProbed,
      by_status: byStatus(endpoints),
    },
  };
}

