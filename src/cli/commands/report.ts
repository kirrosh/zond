import { resolve } from "path";
import { getDb } from "../../db/schema.ts";
import {
  getRunById,
  getResultsByRunId,
  getCollectionById,
  getResultById,
} from "../../db/queries.ts";
import { renderHtmlReport } from "../../core/exporter/html-report/index.ts";
import { renderCaseStudy } from "../../core/exporter/case-study/index.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { loadCoverage } from "../../core/coverage/loader.ts";
import type { CoverageMatrix } from "../../core/coverage/reasons.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { applySanitizer } from "../../core/exporter/exporter.ts";
import { loadIdentityFromAncestor, redactIdentityIn } from "../../core/identity/identity-file.ts";
import { rotateOutputTarget } from "../../core/workspace/output-rotation.ts";
import { resolveTriageOutput } from "../../core/workspace/triage-path.ts";
import { recordGeneratedFile } from "../../core/workspace/manifest.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { VERSION } from "../version.ts";

export interface ReportExportOptions {
  runId: string;
  output?: string;
  api?: string;
  dbPath?: string;
  json?: boolean;
  /** TASK-162 (m-9 P6): when true, overwrite existing target instead of
   *  rotating it to <stem>-vN<ext>. */
  overwrite?: boolean;
  /** TASK-164 (m-9 P8): cap each request/response body to N bytes
   *  (default 8192). Pass 0 to disable. */
  bodyCapBytes?: number;
  /** TASK-173 (m-10): replace every value from `.identity.yaml` with
   *  `<identity:<key>>`. Off by default; opt-in for outbound shares. */
  redactIdentity?: boolean;
}

/** TASK-164: shared default cap. ≤ 8 KB per body keeps Sentry-class
 *  exports under ~150 KB while preserving the first page of every body. */
const DEFAULT_BODY_CAP_BYTES = 8192;

function parseRunId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function reportExportHtmlCommand(
  options: ReportExportOptions,
): Promise<number> {
  const runId = parseRunId(options.runId);
  if (runId == null) {
    const msg = `Invalid run-id: ${options.runId}. Expected a positive integer.`;
    if (options.json) printJson(jsonError("report export --html", [msg]));
    else printError(msg);
    return 2;
  }

  try {
    getDb(options.dbPath);
  } catch (err) {
    const msg = `Failed to open database: ${(err as Error).message}`;
    if (options.json) printJson(jsonError("report export --html", [msg]));
    else printError(msg);
    return 2;
  }

  const run = getRunById(runId);
  if (!run) {
    const msg = `Run #${runId} not found. List runs with: zond db runs`;
    if (options.json) printJson(jsonError("report export --html", [msg]));
    else printError(msg);
    return 1;
  }

  const results = getResultsByRunId(runId);
  const collection = run.collection_id != null ? getCollectionById(run.collection_id) : null;

  // Try to enrich with the spec-aware coverage matrix (TASK-109). Best-effort:
  // skip silently if no API can be resolved or the spec can't load.
  let coverageMatrix: CoverageMatrix | undefined;
  const apiName = options.api ?? collection?.name ?? null;
  if (apiName) {
    try {
      const cov = await loadCoverage({ apiName, runId });
      coverageMatrix = cov.matrix;
    } catch {
      // No registered API / missing spec — fall back to URL-only coverage.
    }
  }

  const html = renderHtmlReport({
    run,
    results,
    zondVersion: VERSION,
    generatedAt: new Date(),
    collectionName: collection?.name ?? null,
    bodyCapBytes: options.bodyCapBytes ?? DEFAULT_BODY_CAP_BYTES,
    ...(coverageMatrix ? { coverageMatrix } : {}),
  });

  // TASK-163 (m-9 P7): default to triage/<api>/<run>/ when --output is
  // missing or just a filename. Explicit dir paths are honoured verbatim.
  const triage = resolveTriageOutput({
    command: "html",
    runId,
    api: apiName,
    ext: "html",
    userOutput: options.output,
  });
  const outputPath = triage.absolute;
  const rotation = rotateOutputTarget(outputPath, { overwrite: options.overwrite });

  try {
    // TASK-168 (m-10): defensive redact pass on the final HTML. Most data
    // is already redacted at DB-write time (TASK-167), but if the user
    // re-ran the same session they may have just registered a new value
    // — wrap the export so it can never out-pace the registry.
    let payload = applySanitizer(html);
    if (options.redactIdentity && collection?.base_dir) {
      const id = loadIdentityFromAncestor(collection.base_dir);
      if (id) payload = redactIdentityIn(payload, id.values);
    }
    await Bun.write(outputPath, payload);
    // TASK-156: register so `zond clean --all` later removes it.
    try {
      const ws = findWorkspaceRoot();
      if (!ws.fromFallback) {
        recordGeneratedFile(ws.root, {
          path: outputPath,
          by: "zond report export",
          api: apiName ?? undefined,
        });
      }
    } catch { /* best-effort */ }
  } catch (err) {
    const msg = `Failed to write report: ${(err as Error).message}`;
    if (options.json) printJson(jsonError("report export --html", [msg]));
    else printError(msg);
    return 2;
  }

  const sizeKb = Math.round(new Blob([html]).size / 1024);
  const warnings: string[] = [];
  if (sizeKb > 2048) {
    warnings.push(`Report is ${sizeKb} KB (>2 MB) — consider trimming response bodies before re-running`);
  }
  if (rotation.rotatedTo) {
    warnings.push(`Previous report rotated to ${rotation.rotatedTo}`);
  }

  if (options.json) {
    printJson(
      jsonOk(
        "report export --html",
        {
          runId,
          output: outputPath,
          sizeKb,
          totalSteps: results.length,
          failures: results.filter((r) => r.status !== "pass" && r.status !== "skip").length,
        },
        warnings,
      ),
    );
  } else {
    for (const w of warnings) printWarning(w);
    const failures = results.filter((r) => r.status !== "pass" && r.status !== "skip").length;
    printSuccess(
      `Wrote ${sizeKb} KB → ${outputPath} (${results.length} step${results.length === 1 ? "" : "s"}, ${failures} failure${failures === 1 ? "" : "s"})`,
    );
  }

  return 0;
}

// ──────────────────────────────────────────────
// `zond report case-study <failure-id>` — TASK-110
// ──────────────────────────────────────────────

export interface ReportCaseStudyOptions {
  failureId: string;
  output?: string;
  dbPath?: string;
  /** Print to stdout instead of (or in addition to) writing a file. */
  stdout?: boolean;
  json?: boolean;
  /** TASK-162 (m-9 P6): overwrite-in-place instead of rotating. */
  overwrite?: boolean;
  /** TASK-164 (m-9 P8): cap response body to N bytes (default 8192,
   *  0 = disabled). */
  bodyCapBytes?: number;
  /** TASK-173 (m-10): swap identity values for placeholders in the draft. */
  redactIdentity?: boolean;
}

export async function reportCaseStudyCommand(
  options: ReportCaseStudyOptions,
): Promise<number> {
  const failureId = parseRunId(options.failureId);
  if (failureId == null) {
    const msg = `Invalid failure-id: ${options.failureId}. Expected a positive integer (results.id).`;
    if (options.json) printJson(jsonError("report case-study", [msg]));
    else printError(msg);
    return 2;
  }

  try {
    getDb(options.dbPath);
  } catch (err) {
    const msg = `Failed to open database: ${(err as Error).message}`;
    if (options.json) printJson(jsonError("report case-study", [msg]));
    else printError(msg);
    return 2;
  }

  const result = getResultById(failureId);
  if (!result) {
    const msg = `Failure #${failureId} not found. Find one via: zond db run <run-id>`;
    if (options.json) printJson(jsonError("report case-study", [msg]));
    else printError(msg);
    return 1;
  }

  const run = getRunById(result.run_id);
  if (!run) {
    const msg = `Internal: failure #${failureId} references missing run #${result.run_id}`;
    if (options.json) printJson(jsonError("report case-study", [msg]));
    else printError(msg);
    return 2;
  }

  // Best-effort spec load for title/version. Don't fail the command if the spec
  // is gone — leave a TODO placeholder in the draft.
  const warnings: string[] = [];
  let specTitle: string | null = null;
  let specVersion: string | null = null;
  if (run.collection_id != null) {
    const collection = getCollectionById(run.collection_id);
    if (collection?.openapi_spec) {
      const specPath = resolveCollectionSpec(collection.openapi_spec);
      try {
        const doc = await readOpenApiSpec(specPath);
        specTitle = doc.info?.title ?? null;
        specVersion = doc.info?.version ?? null;
      } catch (err) {
        warnings.push(
          `Could not load OpenAPI spec from ${specPath}: ${(err as Error).message}. Spec title/version left as TODO.`,
        );
      }
    }
  }

  // TASK-168 (m-10): defensive redact on the rendered draft.
  let md = applySanitizer(renderCaseStudy({
    result,
    run,
    specTitle,
    specVersion,
    zondVersion: VERSION,
    bodyCapBytes: options.bodyCapBytes ?? DEFAULT_BODY_CAP_BYTES,
  }));
  // TASK-173 (m-10): swap identity values for placeholders if requested.
  if (options.redactIdentity && run.collection_id != null) {
    const collection = getCollectionById(run.collection_id);
    if (collection?.base_dir) {
      const id = loadIdentityFromAncestor(collection.base_dir);
      if (id) {
        md = redactIdentityIn(md, id.values);
        warnings.push(`Identity values from ${id.filePath} replaced with placeholders. Re-run without --redact-identity to keep originals.`);
      }
    }
  }

  // Heuristic: if the failure isn't classified as a bug, surface a hint.
  if (result.failure_class && result.failure_class !== "definitely_bug" && result.failure_class !== "likely_bug") {
    warnings.push(
      `Failure is classified as \`${result.failure_class}\`, not a bug. The case-study draft is still rendered, but you may want to pick a more interesting finding.`,
    );
  }

  // TASK-163 (m-9 P7): when no --output is given, default to a per-run
  // triage path. When the user passes --stdout alone, preserve the
  // pipe-friendly stdout-only path. When both --output and --stdout are
  // set, write to disk AND echo to stdout.
  const stdoutOnly = options.stdout === true && !options.output;
  const apiNameForCs = run.collection_id != null ? getCollectionById(run.collection_id)?.name ?? null : null;
  let writtenAbs: string | null = null;

  if (stdoutOnly) {
    if (!options.json) {
      // For human consumption, dump the markdown to stdout so the user can
      // pipe it into `pbcopy`, `gh issue create --body-file -`, etc.
      process.stdout.write(md);
    }
  } else {
    const triage = resolveTriageOutput({
      command: "case-study",
      runId: run.id,
      api: apiNameForCs,
      ext: "md",
      userOutput: options.output,
    });
    try {
      const rot = rotateOutputTarget(triage.absolute, { overwrite: options.overwrite });
      if (rot.rotatedTo) warnings.push(`Previous draft rotated to ${rot.rotatedTo}`);
      await Bun.write(triage.absolute, md);
      writtenAbs = triage.absolute;
      try {
        const ws = findWorkspaceRoot();
        if (!ws.fromFallback) {
          recordGeneratedFile(ws.root, {
            path: triage.absolute,
            by: "zond report case-study",
            api: apiNameForCs ?? undefined,
          });
        }
      } catch { /* best-effort */ }
    } catch (err) {
      const msg = `Failed to write draft: ${(err as Error).message}`;
      if (options.json) printJson(jsonError("report case-study", [msg]));
      else printError(msg);
      return 2;
    }
    if (options.stdout && !options.json) process.stdout.write(md);
    if (!options.json) {
      for (const w of warnings) printWarning(w);
      printSuccess(`Wrote case-study draft → ${triage.relative}`);
    }
  }

  if (options.json) {
    printJson(
      jsonOk(
        "report case-study",
        {
          failureId,
          runId: run.id,
          output: writtenAbs,
          markdown: md,
          failureClass: result.failure_class,
        },
        warnings,
      ),
    );
  }

  return 0;
}


import type { Command } from "commander";
import { globalJson } from "../resolve.ts";
import { parsePositiveInt } from "../argv.ts";
import { reportBundleCommand, type BundleArtifact } from "./report-bundle.ts";

export function registerReport(program: Command): void {
  const reportCmd = program.command("report").description("Export run reports for sharing");
  reportCmd
    .command("export <run-id>")
    .description("Export a stored run as a single-file HTML report (shareable, openable in any browser)")
    .option("--html", "Render as HTML (default and currently the only supported format)")
    .option("-o, --output <file>", "Output file path (default: zond-run-<id>.html)")
    .option("--api <name>", "Embed coverage map for this registered API (auto-detected from run.collection_id)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .option("--body-cap <n>", "Truncate request/response bodies to N bytes (default 8192). Set 0 / use --no-body-cap to disable.", parsePositiveInt("--body-cap"))
    .option("--no-body-cap", "Keep full request/response bodies (overrides --body-cap)")
    .option("--redact-identity", "Replace values from .identity.yaml with <identity:<key>> placeholders (for outbound sharing)")
    .action(async (runId: string, opts, cmd: Command) => {
      const bodyCapBytes = opts.bodyCap === false ? 0 : (typeof opts.bodyCap === "number" ? opts.bodyCap : undefined);
      process.exitCode = await reportExportHtmlCommand({
        runId,
        output: opts.output,
        api: opts.api,
        dbPath: opts.db,
        overwrite: opts.overwrite === true,
        bodyCapBytes,
        redactIdentity: opts.redactIdentity === true,
        json: globalJson(cmd),
      });
    });

  reportCmd
    .command("bundle [range]")
    .description("TASK-143: batch triage exporter — collect case-study + HTML report + diagnose JSON for a range of runs in one shot. <range> can be \"A..B\" (inclusive), \"A,B,C\" (list), or use --session <id>.")
    .option("-o, --output <dir>", "Output directory (default: triage/bundle/<timestamp>/)")
    .option("--session <id>", "Resolve runs by session_id instead of an explicit range")
    .option(
      "--include <artefacts>",
      "Comma-separated subset of artefacts to write (default: all). One or more of: case-study, export, diagnose",
      (val: string) => val.split(",").map(s => s.trim()).filter(Boolean),
    )
    .option("--db <path>", "Path to SQLite database file")
    .option("--body-cap <n>", "Truncate request/response bodies to N bytes (default 8192). Pass 0 / use --no-body-cap to disable.", parsePositiveInt("--body-cap"))
    .option("--no-body-cap", "Keep full request/response bodies (overrides --body-cap)")
    .action(async (range: string | undefined, opts, cmd: Command) => {
      const bodyCapBytes = opts.bodyCap === false ? 0 : (typeof opts.bodyCap === "number" ? opts.bodyCap : undefined);
      const include = (opts.include as string[] | undefined)?.filter(
        (a): a is BundleArtifact => a === "case-study" || a === "export" || a === "diagnose",
      );
      process.exitCode = await reportBundleCommand({
        range,
        sessionId: opts.session,
        output: opts.output,
        include,
        dbPath: opts.db,
        bodyCapBytes,
        json: globalJson(cmd),
      });
    });

  reportCmd
    .command("case-study <failure-id>")
    .description("Generate a markdown case-study draft for a single failure (results.id) — ready to pipe into `gh issue create --body-file -`")
    .option("-o, --output <file>", "Write the draft to a file (default: triage/<api>/<run>/case-study-<ts>.md)")
    .option("--stdout", "Also print the draft to stdout (so it can be piped into pbcopy / gh issue create --body-file -)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--overwrite", "Overwrite existing --output file in place (default: rotate to <stem>-vN.<ext>)")
    .option("--body-cap <n>", "Truncate response body to N bytes (default 8192). Set 0 / use --no-body-cap to disable.", parsePositiveInt("--body-cap"))
    .option("--no-body-cap", "Keep full response body (overrides --body-cap)")
    .option("--redact-identity", "Replace values from .identity.yaml with <identity:<key>> placeholders (for outbound sharing)")
    .action(async (failureId: string, opts, cmd: Command) => {
      const bodyCapBytes = opts.bodyCap === false ? 0 : (typeof opts.bodyCap === "number" ? opts.bodyCap : undefined);
      process.exitCode = await reportCaseStudyCommand({
        failureId,
        output: opts.output,
        dbPath: opts.db,
        stdout: opts.stdout === true,
        overwrite: opts.overwrite === true,
        bodyCapBytes,
        redactIdentity: opts.redactIdentity === true,
        json: globalJson(cmd),
      });
    });
}
