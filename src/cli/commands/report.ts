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
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { VERSION } from "../version.ts";

export interface ReportExportOptions {
  runId: string;
  output?: string;
  dbPath?: string;
  json?: boolean;
}

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

  const html = renderHtmlReport({
    run,
    results,
    zondVersion: VERSION,
    generatedAt: new Date(),
    collectionName: collection?.name ?? null,
  });

  const outputPath = resolve(options.output ?? `zond-run-${runId}.html`);

  try {
    await Bun.write(outputPath, html);
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
      try {
        const doc = await readOpenApiSpec(collection.openapi_spec);
        specTitle = doc.info?.title ?? null;
        specVersion = doc.info?.version ?? null;
      } catch (err) {
        warnings.push(
          `Could not load OpenAPI spec from ${collection.openapi_spec}: ${(err as Error).message}. Spec title/version left as TODO.`,
        );
      }
    }
  }

  const md = renderCaseStudy({
    result,
    run,
    specTitle,
    specVersion,
    zondVersion: VERSION,
  });

  // Heuristic: if the failure isn't classified as a bug, surface a hint.
  if (result.failure_class && result.failure_class !== "definitely_bug" && result.failure_class !== "likely_bug") {
    warnings.push(
      `Failure is classified as \`${result.failure_class}\`, not a bug. The case-study draft is still rendered, but you may want to pick a more interesting finding.`,
    );
  }

  if (options.stdout || !options.output) {
    if (options.output) {
      // Both: write file AND print to stdout
      try {
        await Bun.write(resolve(options.output), md);
      } catch (err) {
        const msg = `Failed to write draft: ${(err as Error).message}`;
        if (options.json) printJson(jsonError("report case-study", [msg]));
        else printError(msg);
        return 2;
      }
    }
    if (!options.json) {
      // For human consumption, dump the markdown to stdout so the user can
      // pipe it into `pbcopy`, `gh issue create --body-file -`, etc.
      process.stdout.write(md);
    }
  } else {
    try {
      await Bun.write(resolve(options.output), md);
    } catch (err) {
      const msg = `Failed to write draft: ${(err as Error).message}`;
      if (options.json) printJson(jsonError("report case-study", [msg]));
      else printError(msg);
      return 2;
    }
    if (!options.json) {
      for (const w of warnings) printWarning(w);
      printSuccess(`Wrote case-study draft → ${resolve(options.output)}`);
    }
  }

  if (options.json) {
    printJson(
      jsonOk(
        "report case-study",
        {
          failureId,
          runId: run.id,
          output: options.output ? resolve(options.output) : null,
          markdown: md,
          failureClass: result.failure_class,
        },
        warnings,
      ),
    );
  }

  return 0;
}

