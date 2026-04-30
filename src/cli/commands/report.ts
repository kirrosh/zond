import { resolve } from "path";
import { getDb } from "../../db/schema.ts";
import { getRunById, getResultsByRunId, getCollectionById } from "../../db/queries.ts";
import { renderHtmlReport } from "../../core/exporter/html-report/index.ts";
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
