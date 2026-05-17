import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { loadEnvironment, loadEnvFile } from "../../../core/parser/variables.ts";
import {
  runMassAssignmentProbes,
  formatDigestMarkdown,
  emitRegressionSuites,
} from "../../../core/probe/mass-assignment-probe.ts";
import { loadSpecForProbe, writeProbeSuites } from "../../../core/probe/runner.ts";
import { printError, printSuccess, printWarning } from "../../output.ts";
import { jsonOk, jsonError, printJson } from "../../json-envelope.ts";
import { getSecretRegistry } from "../../../core/secrets/registry.ts";
import { applySanitizer } from "../../../core/exporter/exporter.ts";
import { rotateOutputTarget } from "../../../core/workspace/output-rotation.ts";
import { tallyBySeverity, formatSummaryLine } from "../../../core/probe/verdict-aggregator.ts";
import { printMutationBanner, countCleanupFailures } from "../../../core/probe/shared.ts";
import { MassAssignmentProbe } from "../../../core/probe/mass-assignment-probe-class.ts";
import { summarizeDryRun, formatDryRunDigest } from "../../../core/probe/dry-run-envelope.ts";
import { compileOperationFilter } from "../../../core/selectors/operation-filter.ts";
import type { EndpointVerdict, MassAssignmentResult } from "../../../core/probe/mass-assignment-probe.ts";
import type { ProbeEndpointResult, ProbeEndpointStatus, ProbeFindingSeverity } from "../../../core/probe/types.ts";

interface BucketCounts {
  high: number;
  inconclusiveBaseline: number;
  inconclusive5xx: number;
  medium: number;
  low: number;
  ok: number;
  skipped: number;
}

const MA_BUCKETS: ReadonlyArray<readonly [string, keyof BucketCounts & string]> = [
  ["high", "high"],
  ["inconclusive-baseline", "inconclusiveBaseline"],
  ["inconclusive-5xx", "inconclusive5xx"],
  ["medium", "medium"],
  ["low", "low"],
  ["ok", "ok"],
  ["skipped", "skipped"],
];

const MA_SUMMARY: ReadonlyArray<readonly [string, keyof BucketCounts & string]> = [
  ["HIGH", "high"],
  ["INCONCLUSIVE", "inconclusiveBaseline"],
  ["INCONCLUSIVE-5XX", "inconclusive5xx"],
  ["MED", "medium"],
  ["LOW", "low"],
  ["OK", "ok"],
  ["SKIPPED", "skipped"],
];

const MA_ZERO: BucketCounts = {
  high: 0, inconclusiveBaseline: 0, inconclusive5xx: 0, medium: 0, low: 0, ok: 0, skipped: 0,
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
  /** m-17 / ARV-52: list which endpoints + fields would be attacked
   *  without sending live traffic. */
  dryRun?: boolean;
  /** m-17 / ARV-52: m-15 ARV-9 selector grammar (`path:`/`method:`/`tag:`/`operation-id:`). */
  include?: string[];
  exclude?: string[];
  /** m-17 / ARV-51: format for --output / non-json stdout. */
  report?: "markdown" | "json";
  /** ARV-252: surface INFO-severity inconclusive verdicts (absent-but-
   *  unverifiable). Silently-ignored verdicts are never shown — they
   *  represent correct framework behaviour. */
  verbose?: boolean;
  /** ARV-252: additional suspect fields to inject, in `name=value`
   *  form. Extends the curated SUSPECTED_FIELDS list per-run. Full
   *  spec-extension support (x-zond-suspect-fields) is tracked in
   *  ARV-189. */
  suspectField?: string[];
  /** ARV-265: collection name for audit-coverage attribution. Set by
   *  the CLI when --api / current-api resolves; left undefined for
   *  bare-spec invocations. */
  apiName?: string;
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
    const { endpoints: rawEndpoints, securitySchemes } = loaded;

    // m-17 / ARV-52: apply --include / --exclude through the unified
    // operation filter (m-15 ARV-9). probe-family was deferred at AC#6;
    // wiring it here closes that and gives mass-assignment parity with
    // probe-static / probe-security.
    let endpoints = rawEndpoints;
    if (options.include?.length || options.exclude?.length) {
      const compiled = compileOperationFilter({ includes: options.include, excludes: options.exclude });
      if (compiled.errors.length > 0) {
        const message = compiled.errors.join("\n");
        if (options.json) printJson(jsonError("probe-mass-assignment", [message]));
        else printError(message);
        return 2;
      }
      endpoints = endpoints.filter(compiled.filter);
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

    // m-17 / ARV-52: --dry-run lists which endpoints + suspect fields the
    // probe would touch without sending live traffic. base_url is not
    // required on this path (mirrors probe-security).
    if (options.dryRun) {
      const probe = new MassAssignmentProbe();
      const plan = await probe.dryRun({
        specPath: options.specPath,
        endpoints,
        securitySchemes,
        vars,
        options: {},
      });
      const data = summarizeDryRun(plan);
      if (options.json) {
        printJson(jsonOk("probe-mass-assignment", data));
      } else {
        console.log(formatDryRunDigest(plan));
      }
      return 0;
    }

    if (!vars["base_url"]) {
      const msg = "base_url is required (set in .env.yaml or via --env file). Probing requires a live API.";
      if (options.json) printJson(jsonError("probe-mass-assignment", [msg]));
      else printError(msg);
      return 2;
    }

    // TASK-259: tell the user *before* we mutate anything. Suppressed in
    // --json mode (warnings already in envelope) and when --no-cleanup
    // is off — this banner is about the cleanup-pass, too.
    printMutationBanner("probe-mass-assignment", vars, { quiet: options.json === true });

    // ARV-265: capture HTTP touches for audit-coverage. Dry-run never
    // reaches this branch (early return above), so AC#5 holds.
    const { withHttpAudit, beginAuditRun, finalizeAuditRun, auditRecordToCase, checksPersistEnabled } =
      await import("../../../core/audit/persist.ts");
    const auditEnabled = checksPersistEnabled();
    const { value: result, records: auditRecords } = await withHttpAudit(async () =>
      runMassAssignmentProbes({
        endpoints,
        securitySchemes,
        vars,
        noCleanup: options.noCleanup,
        timeoutMs: options.timeoutMs,
        discover: !options.noDiscover,
        extraSuspectFields: parseSuspectFieldFlags(options.suspectField),
      }),
    );

    if (auditEnabled && auditRecords.length > 0) {
      try {
        const { getDb } = await import("../../../db/schema.ts");
        const { findCollectionByNameOrId } = await import("../../../db/queries.ts");
        const { readCurrentSession } = await import("../../../core/context/session.ts");
        getDb();
        const collectionId = options.apiName ? findCollectionByNameOrId(options.apiName)?.id : undefined;
        const session = readCurrentSession();
        const runId = beginAuditRun({
          runKind: "probe",
          ...(collectionId != null ? { collectionId } : {}),
          ...(session?.id ? { sessionId: session.id } : {}),
          tags: ["probe", "mass-assignment"],
        });
        const suiteFile = `apis/${options.apiName ?? "_"}/probes/mass-assignment.yaml`;
        finalizeAuditRun(runId, auditRecords.map((rec) =>
          auditRecordToCase(rec, {
            suiteName: "probe/mass-assignment",
            suiteFile,
            testName: `mass-assignment::${rec.request.method.toUpperCase()} ${rec.request.url}`,
          }),
        ));
      } catch (err) {
        process.stderr.write(`zond: audit persistence failed (${(err as Error).message}).\n`);
      }
    }

    // ARV-252: filter verdicts for display under the evidence-chain
    // principle. Silently-ignored (correct framework behaviour) never
    // surfaces; absent-but-unverifiable surfaces only under --verbose.
    // HIGH and inconclusive-baseline/5xx always show. JSON envelope
    // always carries the full unfiltered list (agents triage explicitly).
    const displayResult: MassAssignmentResult = {
      ...result,
      verdicts: filterVerdictsForDisplay(result.verdicts, { verbose: options.verbose === true }),
    };

    // TASK-168 (m-10): vars came from .env.yaml — register them so any
    // echoed token (URL, body, header) gets redacted in the digest.
    getSecretRegistry().registerAll(vars);
    const md = applySanitizer(formatDigestMarkdown(displayResult, options.specPath));

    // m-17 / ARV-51: --output writes whichever format `--report` selected
    // (default markdown). `--json` envelope is always structured.
    const reportFmt: "markdown" | "json" = options.report ?? "markdown";
    const structuredEndpoints = buildMaStructuredEndpoints(result);
    if (options.output) {
      await mkdir(join(options.output, "..").replace(/\/\.$/, ""), { recursive: true }).catch(() => {});
      // TASK-162 (m-9 P6): rotate previous digest to <stem>-vN.md instead
      // of silent overwrite. --overwrite opts back into the old behaviour.
      rotateOutputTarget(options.output, { overwrite: options.overwrite });
      const payload = reportFmt === "json"
        ? JSON.stringify(maStructuredReport(result, structuredEndpoints), null, 2) + "\n"
        : md;
      await writeFile(options.output, payload, "utf-8");
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
    const orphans = countCleanupFailures(result.verdicts);

    if (options.json) {
      // m-17 / ARV-51: structured envelope; no `data.digest.stdout`.
      printJson(
        jsonOk("probe-mass-assignment", {
          endpoints: structuredEndpoints,
          summary: {
            totalEndpoints: result.totalEndpoints,
            probed: result.specProbed,
            by_status: maByStatus(structuredEndpoints),
          },
          orphans,
          warnings: result.warnings,
          emittedTests: emittedSuites,
        }),
      );
    } else {
      if (!options.output) {
        if (reportFmt === "json") {
          process.stdout.write(JSON.stringify(maStructuredReport(result, structuredEndpoints), null, 2) + "\n");
        } else {
          console.log(md);
        }
      } else printSuccess(`${reportFmt === "json" ? "Structured report" : "Digest"} written to ${options.output}`);
      console.log("");
      console.log(formatSummaryLine(counts, MA_SUMMARY));
      if (emittedSuites.length > 0) {
        printSuccess(`Emitted ${emittedSuites.length} regression suite(s) in ${options.emitTests}`);
        console.log(`  Run them on CI: zond run ${options.emitTests} --env ${options.env ?? ".env.yaml"}`);
      } else if (options.emitTests) {
        console.log(`No findings to emit. Directory ${options.emitTests} not created.`);
      }
      if (counts.high > 0) {
        printWarning(`${counts.high} HIGH-severity finding(s) — privilege escalation candidates. Review the digest.`);
      }
      if (counts.inconclusiveBaseline > 0) {
        printWarning(
          `${counts.inconclusiveBaseline} endpoint(s) had baseline POST failures — fix env fixtures (FK ids / path-params) and re-run. These are excluded from --emit-tests on purpose.`,
        );
      }
      // TASK-259: cleanup-failure surfaces as "orphans" in summary. 404 was
      // already filtered out (resource gone is success). Prompt for manual
      // cleanup so the user doesn't discover the leak only via 5xx in CI.
      if (orphans > 0) {
        printWarning(
          `${orphans} orphan resource(s): cleanup DELETE failed (non-404). Manual cleanup may be needed — see digest "Cleanup DELETE: …" lines.`,
        );
      }
      // Stale-fixture hint when probes successfully cleaned up at least one
      // resource: that means we POSTed (and re-DELETEd) — `.env.yaml` slug/id
      // values for that resource type may now point at a tombstone.
      const cleanedCount = result.verdicts.filter(v => v.cleanup?.attempted && v.cleanup.status != null && v.cleanup.status < 400).length;
      if (cleanedCount > 0) {
        printWarning(
          `${cleanedCount} resource(s) created and deleted by probes. FK fixtures in .env.yaml may be stale — re-run \`zond prepare-fixtures --api <name>\` before next CRUD run.`,
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

// ──────────────────────────────────────────────
// TASK-146: --emit-template short-circuit
// ──────────────────────────────────────────────

import { buildMassAssignmentTemplate } from "../../../core/probe/mass-assignment-template.ts";

export interface EmitTemplateCliOptions {
  specPath: string;
  /** "METHOD:/path", e.g. "POST:/users" or "POST /users". */
  methodPath: string;
  output?: string;
  json?: boolean;
}

export async function emitMassAssignmentTemplateCommand(
  options: EmitTemplateCliOptions,
): Promise<number> {
  const parsed = parseMethodPath(options.methodPath);
  if (!parsed) {
    const msg = `--emit-template expects "METHOD:/path" (e.g. "POST:/users"), got: ${options.methodPath}`;
    if (options.json) printJson(jsonError("probe-mass-assignment", [msg]));
    else printError(msg);
    return 2;
  }

  try {
    const result = await buildMassAssignmentTemplate({
      specPath: options.specPath,
      method: parsed.method,
      path: parsed.path,
    });

    if (result.kind === "endpoint-not-found") {
      const lines = [`endpoint not found: ${parsed.method} ${parsed.path}`];
      if (result.nearest.length > 0) {
        lines.push(`nearest paths with method ${parsed.method}: ${result.nearest.join(", ")}`);
      }
      const msg = lines.join("\n");
      if (options.json) printJson(jsonError("probe-mass-assignment", [msg]));
      else printError(msg);
      return 2;
    }

    if (options.output) {
      await mkdir(join(options.output, "..").replace(/[^/]+$/, ""), { recursive: true }).catch(() => {});
      await writeFile(options.output, result.yaml, "utf-8");
      if (options.json) {
        printJson(
          jsonOk("probe-mass-assignment", {
            template: { file: options.output, chain: result.chain, protectedFields: result.protectedFields },
          }),
        );
      } else {
        printSuccess(`Template written to ${options.output} (chain=${result.chain})`);
        if (result.protectedFields.length > 0) {
          console.log(`  readOnly/x-zond-protected fields injected: ${result.protectedFields.join(", ")}`);
        }
      }
    } else {
      if (options.json) {
        printJson(
          jsonOk("probe-mass-assignment", {
            template: { yaml: result.yaml, chain: result.chain, protectedFields: result.protectedFields },
          }),
        );
      } else {
        process.stdout.write(result.yaml);
      }
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("probe-mass-assignment", [message]));
    else printError(message);
    return 2;
  }
}

function parseMethodPath(s: string): { method: string; path: string } | null {
  const m = s.match(/^\s*([A-Za-z]+)\s*[: ]\s*(\/.*?)\s*$/);
  if (!m) return null;
  return { method: m[1]!.toUpperCase(), path: m[2]! };
}

// m-17 / ARV-51: structured per-endpoint shape for mass-assignment.

/**
 * ARV-252: parse repeatable `--suspect-field name=value` flags into the
 * extra-fields map. Values are kept as strings — generateFromSchema /
 * sentinel inference happens server-side via the suspect-fields machinery.
 * Malformed entries (no `=`) are skipped silently rather than failing the
 * run — this keeps ad-hoc CLI usage forgiving.
 */
function parseSuspectFieldFlags(raw: string[] | undefined): Record<string, unknown> | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const entry of raw) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1);
    if (name) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * ARV-252: filter verdicts for the digest/console display under the
 * evidence-chain principle.
 *
 * - HIGH (applied) — always show; this is the actual finding.
 * - inconclusive-baseline / inconclusive-5xx / ok / skipped — always
 *   show; operator needs them to triage probe coverage.
 * - INFO with at least one `absent` outcome (couldn't verify via
 *   follow-up GET) — show only under --verbose. This is the "single
 *   signal, no proof" case.
 * - INFO with only `ignored` outcomes (silently dropped — correct
 *   framework behaviour) — NEVER show. Reports must not noise-floor
 *   on intentional behaviour.
 *
 * JSON envelope is unfiltered; this is a display-layer transform only.
 */
function filterVerdictsForDisplay(
  verdicts: EndpointVerdict[],
  opts: { verbose: boolean },
): EndpointVerdict[] {
  return verdicts.filter((v) => {
    if (v.severity !== "info") return true;
    const hasAbsent = v.fields.some((f) => f.outcome === "absent");
    if (!hasAbsent) return false; // silently-ignored: always hidden
    return opts.verbose;
  });
}

function maStatusFromSeverity(s: EndpointVerdict["severity"]): ProbeEndpointStatus {
  switch (s) {
    case "high": return "high";
    case "low":
    case "medium":
    case "info":
      return "low";
    case "ok": return "ok";
    case "skipped": return "skipped";
    case "inconclusive-baseline":
    case "inconclusive-5xx":
      return "inconclusive";
  }
}

function maFindingSeverity(s: EndpointVerdict["severity"]): ProbeFindingSeverity {
  if (s === "high") return "high";
  if (s === "low" || s === "medium") return "low";
  if (s === "ok") return "ok";
  return "inconclusive";
}

function buildMaStructuredEndpoints(result: MassAssignmentResult): ProbeEndpointResult[] {
  return result.verdicts.map((v) => ({
    path: v.path,
    method: v.method,
    classes_run: ["mass-assignment"],
    findings: v.severity === "skipped" || v.severity === "ok"
      ? []
      : [{
          class: "mass-assignment",
          severity: maFindingSeverity(v.severity),
          evidence: {
            summary: v.summary,
            request: { url: v.request.url, injectedFields: v.request.injectedFields },
            ...(v.response ? { response: { status: v.response.status } } : {}),
            ...(v.fields ? { fields: v.fields } : {}),
            ...(v.recommended_action ? { recommended_action: v.recommended_action } : {}),
          },
        }],
    status: maStatusFromSeverity(v.severity),
    ...(v.severity === "skipped" ? { skip_reason: v.skipReason ?? v.summary } : {}),
  }));
}

function maByStatus(endpoints: ProbeEndpointResult[]): Record<ProbeEndpointStatus, number> {
  const out: Record<ProbeEndpointStatus, number> = {
    ok: 0, high: 0, low: 0, inconclusive: 0, skipped: 0,
  };
  for (const e of endpoints) out[e.status]++;
  return out;
}

function maStructuredReport(result: MassAssignmentResult, endpoints: ProbeEndpointResult[]): object {
  return {
    endpoints,
    summary: {
      totalEndpoints: result.totalEndpoints,
      probed: result.specProbed,
      by_status: maByStatus(endpoints),
    },
  };
}

