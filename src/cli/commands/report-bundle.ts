/**
 * TASK-143: `zond report bundle <range> [--output <dir>] [--include ...]`.
 *
 * Batch triage exporter — collects case-study + HTML report + diagnose JSON
 * for a range of run-ids in one command, plus a top-level index.md with a
 * table of run-id, totals, and links.
 *
 * Range forms:
 *   A..B               inclusive numeric range, e.g. "135..142"
 *   A,B,C              comma-separated list
 *   --session <id>     all runs for a CLI session (DB column `session_id`)
 */
import { join } from "path";
import { mkdir } from "fs/promises";
import { getDb } from "../../db/schema.ts";
import { getRunById, getResultsByRunId, getCollectionById } from "../../db/queries.ts";
import type { RunRecord, StoredStepResult } from "../../db/queries/types.ts";
import { renderHtmlReport } from "../../core/exporter/html-report/index.ts";
import { renderCaseStudy } from "../../core/exporter/case-study/index.ts";
import { diagnoseRun } from "../../core/diagnostics/db-analysis.ts";
import { applySanitizer } from "../../core/exporter/exporter.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import { printError, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { VERSION } from "../version.ts";

export type BundleArtifact = "case-study" | "export" | "diagnose";

export interface ReportBundleOptions {
  /** "A..B" range, "A,B,C" list, or unused when sessionId is set. */
  range?: string;
  /** Resolve runs by session_id instead of explicit ids. */
  sessionId?: string;
  output?: string;
  include?: BundleArtifact[];
  bodyCapBytes?: number;
  dbPath?: string;
  json?: boolean;
}

const DEFAULT_BODY_CAP_BYTES = 8192;
const ALL_ARTIFACTS: BundleArtifact[] = ["case-study", "export", "diagnose"];

interface BundleEntry {
  runId: number;
  spec: string | null;
  totals: { total: number; passed: number; failed: number; skipped: number };
  caseStudy?: string;
  htmlReport?: string;
  diagnose?: string;
  agentDirective?: string | null;
}

export function parseBundleRange(input: string): number[] | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: "empty range" };

  const rangeMatch = trimmed.match(/^(\d+)\.\.(\d+)$/);
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1]!, 10);
    const b = parseInt(rangeMatch[2]!, 10);
    if (a > b) return { error: `range start ${a} is greater than end ${b}` };
    const out: number[] = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  }

  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map(s => s.trim()).filter(Boolean);
    const ids: number[] = [];
    for (const p of parts) {
      const n = parseInt(p, 10);
      if (!Number.isFinite(n) || n <= 0) return { error: `not a positive integer: ${p}` };
      ids.push(n);
    }
    return Array.from(new Set(ids)).sort((a, b) => a - b);
  }

  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return { error: `not a recognised range: ${trimmed}` };
  return [n];
}

export async function reportBundleCommand(options: ReportBundleOptions): Promise<number> {
  try {
    getDb(options.dbPath);
  } catch (err) {
    const msg = `Failed to open database: ${(err as Error).message}`;
    if (options.json) printJson(jsonError("report bundle", [msg]));
    else printError(msg);
    return 2;
  }

  let runIds: number[];
  if (options.sessionId) {
    runIds = listRunIdsBySession(options.sessionId);
    if (runIds.length === 0) {
      const msg = `No runs found for --session ${options.sessionId}`;
      if (options.json) printJson(jsonError("report bundle", [msg]));
      else printError(msg);
      return 1;
    }
  } else {
    if (!options.range) {
      const msg = "report bundle requires <range> (A..B / A,B,C) or --session <id>";
      if (options.json) printJson(jsonError("report bundle", [msg]));
      else printError(msg);
      return 2;
    }
    const parsed = parseBundleRange(options.range);
    if (!Array.isArray(parsed)) {
      const msg = `Invalid range: ${parsed.error}. Examples: 135..142, 135,137,141`;
      if (options.json) printJson(jsonError("report bundle", [msg]));
      else printError(msg);
      return 2;
    }
    runIds = parsed;
  }

  const include = options.include && options.include.length > 0 ? options.include : ALL_ARTIFACTS;
  const outDir = options.output ?? join("triage", "bundle", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(outDir, { recursive: true });

  const entries: BundleEntry[] = [];
  const skipped: Array<{ runId: number; reason: string }> = [];
  const bodyCap = options.bodyCapBytes ?? DEFAULT_BODY_CAP_BYTES;

  for (const runId of runIds) {
    const run = getRunById(runId);
    if (!run) {
      skipped.push({ runId, reason: "not found" });
      continue;
    }
    const results = getResultsByRunId(runId);
    const runDir = join(outDir, String(runId));
    await mkdir(runDir, { recursive: true });

    const entry: BundleEntry = {
      runId,
      spec: await loadSpecTitle(run),
      totals: {
        total: run.total ?? 0,
        passed: run.passed ?? 0,
        failed: run.failed ?? 0,
        skipped: run.skipped ?? 0,
      },
    };

    if (include.includes("export")) {
      const html = renderHtmlReport({
        run,
        results,
        zondVersion: VERSION,
        generatedAt: new Date(),
        collectionName: run.collection_id != null ? getCollectionById(run.collection_id)?.name ?? null : null,
        bodyCapBytes: bodyCap,
      });
      const file = join(runDir, "report.html");
      await Bun.write(file, html);
      entry.htmlReport = file;
    }

    if (include.includes("case-study")) {
      const failure = pickPrimaryFailure(results);
      if (failure) {
        const md = applySanitizer(renderCaseStudy({
          result: failure,
          run,
          specTitle: entry.spec,
          specVersion: null,
          zondVersion: VERSION,
          bodyCapBytes: bodyCap,
        }));
        const file = join(runDir, "case-study.md");
        await Bun.write(file, md);
        entry.caseStudy = file;
      }
    }

    if (include.includes("diagnose")) {
      const diag = diagnoseRun(runId, false, options.dbPath, 5);
      const file = join(runDir, "diagnose.json");
      await Bun.write(file, JSON.stringify(diag, null, 2));
      entry.diagnose = file;
      entry.agentDirective = (diag as unknown as { agent_directive?: string }).agent_directive ?? null;
    }

    entries.push(entry);
  }

  if (entries.length === 0) {
    const msg = `No runs in [${runIds.join(", ")}] resolved to existing rows`;
    if (options.json) printJson(jsonError("report bundle", [msg]));
    else printError(msg);
    return 1;
  }

  const indexPath = join(outDir, "index.md");
  await Bun.write(indexPath, renderIndex(entries, skipped));

  if (options.json) {
    printJson(
      jsonOk("report bundle", {
        outputDir: outDir,
        index: indexPath,
        entries: entries.map(e => ({
          runId: e.runId,
          spec: e.spec,
          totals: e.totals,
          caseStudy: e.caseStudy ?? null,
          htmlReport: e.htmlReport ?? null,
          diagnose: e.diagnose ?? null,
          agentDirective: e.agentDirective ?? null,
        })),
        skipped,
      }),
    );
  } else {
    if (skipped.length > 0) {
      for (const s of skipped) printWarning(`Run #${s.runId} skipped: ${s.reason}`);
    }
    // TASK-241: status → stderr; stdout carries only the bundle dir path.
    process.stderr.write(`zond: bundle written (${entries.length} run(s), index: ${indexPath})\n`,);
    process.stdout.write(`${outDir}\n`);
  }
  return 0;
}

function listRunIdsBySession(sessionId: string): number[] {
  const db = getDb();
  const rows = db.query("SELECT id FROM runs WHERE session_id = ? ORDER BY started_at ASC")
    .all(sessionId) as Array<{ id: number }>;
  return rows.map(r => r.id);
}

async function loadSpecTitle(run: RunRecord): Promise<string | null> {
  if (run.collection_id == null) return null;
  const collection = getCollectionById(run.collection_id);
  if (!collection?.openapi_spec) return collection?.name ?? null;
  try {
    const doc = await readOpenApiSpec(resolveCollectionSpec(collection.openapi_spec));
    return doc.info?.title ?? collection.name ?? null;
  } catch {
    return collection.name ?? null;
  }
}

function pickPrimaryFailure(results: StoredStepResult[]): StoredStepResult | null {
  // Prefer a result classified as a real bug.
  const bugFirst = results.find(
    r => r.status !== "pass" && (r.failure_class === "definitely_bug" || r.failure_class === "likely_bug"),
  );
  if (bugFirst) return bugFirst;
  return results.find(r => r.status === "fail" || r.status === "5xx") ?? null;
}

function renderIndex(entries: BundleEntry[], skipped: Array<{ runId: number; reason: string }>): string {
  const lines: string[] = [];
  lines.push("# Bundle index", "");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Runs: ${entries.length}` + (skipped.length > 0 ? ` (skipped: ${skipped.length})` : ""));
  lines.push("");
  lines.push("| Run | Spec | Total | Pass | Fail | Skip | Artefacts | Directive |");
  lines.push("|----:|------|------:|-----:|-----:|-----:|-----------|-----------|");

  for (const e of entries) {
    const links: string[] = [];
    if (e.caseStudy) links.push(`[case-study](${rel(e.caseStudy)})`);
    if (e.htmlReport) links.push(`[html](${rel(e.htmlReport)})`);
    if (e.diagnose) links.push(`[diagnose](${rel(e.diagnose)})`);
    lines.push(
      `| ${e.runId} | ${e.spec ?? "—"} | ${e.totals.total} | ${e.totals.passed} | ${e.totals.failed} | ${e.totals.skipped} | ${links.join(" · ") || "—"} | ${truncate(e.agentDirective ?? "", 80)} |`,
    );
  }

  if (skipped.length > 0) {
    lines.push("", "## Skipped", "");
    for (const s of skipped) lines.push(`- run #${s.runId} — ${s.reason}`);
  }
  return lines.join("\n") + "\n";
}

function rel(p: string): string {
  // Index lives at <dir>/index.md, run files at <dir>/<id>/<file> — strip the
  // shared parent so relative links still work after the dir is moved.
  const seg = p.split(/[/\\]/);
  const tail = seg.slice(-2);
  return tail.join("/");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s.replace(/\n/g, " ");
  return s.slice(0, n - 1).replace(/\n/g, " ") + "…";
}
