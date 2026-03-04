/**
 * Runs tab: history of test runs with comparison.
 */

import { escapeHtml } from "./layout.ts";
import { statusBadge } from "./results.ts";
import { formatDuration } from "../../core/reporter/console.ts";
import {
  listRunsByCollection,
  countRunsByCollection,
  getResultsByRunId,
  getRunById,
} from "../../db/queries.ts";
import type { RunSummary } from "../../db/queries.ts";
import { renderSuiteResults, failedFilterToggle, autoExpandFailedScript } from "./results.ts";

const PAGE_SIZE = 15;

export function renderRunsTab(collectionId: number, page = 1): string {
  const offset = (page - 1) * PAGE_SIZE;
  const runs = listRunsByCollection(collectionId, PAGE_SIZE, offset);
  const total = countRunsByCollection(collectionId);
  const hasMore = offset + runs.length < total;

  if (runs.length === 0 && page === 1) {
    return `<div class="tab-empty">No test runs yet. Click <strong>Run Tests</strong> to get started.</div>`;
  }

  const rows = runs.map(r => renderRunRow(r, collectionId)).join("");

  const loadMore = hasMore
    ? `<div style="text-align:center;padding:0.75rem;">
        <button class="btn btn-sm btn-outline"
          hx-get="/panels/runs-tab?collection_id=${collectionId}&page=${page + 1}"
          hx-target="#tab-content" hx-swap="innerHTML">Load more...</button>
      </div>`
    : "";

  return `
    <div class="runs-list">
      <div class="runs-header">
        <span>Run</span><span>Time</span><span>Results</span><span>Duration</span><span>Status</span>
      </div>
      ${rows}
      ${loadMore}
    </div>`;
}

function renderRunRow(run: RunSummary, collectionId: number): string {
  const timeAgo = formatTimeAgo(run.started_at);
  const duration = run.duration_ms != null ? formatDuration(run.duration_ms) : "-";
  const total = run.total || 1;

  // Mini progress bar
  const progressBar = run.total > 0
    ? `<div class="progress-bar run-progress">
        <div class="progress-pass" style="width:${(run.passed / total * 100).toFixed(1)}%"></div>
        <div class="progress-fail" style="width:${(run.failed / total * 100).toFixed(1)}%"></div>
      </div>`
    : "";

  return `
    <div class="run-row"
      hx-get="/panels/run-detail?run_id=${run.id}&collection_id=${collectionId}"
      hx-target="#tab-content" hx-swap="innerHTML">
      <span class="run-id">#${run.id}</span>
      <span class="run-time">${escapeHtml(timeAgo)}</span>
      <span class="run-results">
        ${progressBar}
        <span class="run-counts">${run.passed}&#10003; ${run.failed}&#10007; ${run.skipped}&#9675;</span>
      </span>
      <span class="run-duration">${duration}</span>
      <span>${statusBadge(run.total, run.passed, run.failed)}</span>
    </div>`;
}

export function renderRunDetail(runId: number, collectionId: number): string {
  const run = getRunById(runId);
  if (!run) return `<p>Run not found</p>`;

  const results = getResultsByRunId(runId);
  if (results.length === 0) return `<p class="tab-empty">No results for run #${runId}.</p>`;

  const timeAgo = formatTimeAgo(run.started_at);
  const duration = run.duration_ms != null ? formatDuration(run.duration_ms) : "-";

  const backButton = `<button class="btn btn-sm btn-outline" style="margin-bottom:0.75rem;"
    hx-get="/panels/runs-tab?collection_id=${collectionId}"
    hx-target="#tab-content" hx-swap="innerHTML">&larr; Back to runs</button>`;

  const header = `
    <div class="run-detail-header">
      <strong>Run #${run.id}</strong>
      <span class="text-dim">${escapeHtml(timeAgo)}</span>
      <span>${run.passed}&#10003; ${run.failed}&#10007; ${run.skipped}&#9675;</span>
      <span class="text-dim">${duration}</span>
      ${statusBadge(run.total, run.passed, run.failed)}
      <span style="flex:1;"></span>
      <a href="/api/export/${run.id}/junit" download class="btn btn-sm btn-outline">JUnit</a>
      <a href="/api/export/${run.id}/json" download class="btn btn-sm btn-outline">JSON</a>
      ${failedFilterToggle()}
    </div>`;

  const suitesHtml = renderSuiteResults(results, runId);

  return backButton + header + suitesHtml + autoExpandFailedScript();
}

function formatTimeAgo(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  } catch {
    return isoDate;
  }
}
