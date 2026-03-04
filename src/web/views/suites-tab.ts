/**
 * Suites tab: all YAML files on disk with run status.
 */

import type { CollectionState, SuiteViewState } from "../data/collection-state.ts";
import { escapeHtml } from "./layout.ts";
import { basename } from "node:path";

export function renderSuitesTab(state: CollectionState): string {
  if (state.suites.length === 0) {
    return `<div class="tab-empty">No test suites found on disk. Generate tests with <code>generate_tests_guide</code> or <code>generate_and_save</code>.</div>`;
  }

  const rows = state.suites.map((s, i) => renderSuiteRow(s, i)).join("");
  return `<div class="suite-list">${rows}</div>`;
}

function renderSuiteRow(suite: SuiteViewState, index: number): string {
  const detailId = `suite-detail-${index}`;
  const fileName = basename(suite.filePath || suite.name);

  if (suite.status === "parse_error") {
    return `
      <div class="suite-row suite-error-row">
        <div class="suite-info">
          <div class="suite-name">${escapeHtml(fileName)}</div>
          <div class="suite-desc" style="color:var(--fail);">${escapeHtml(suite.parseError ?? "Parse error")}</div>
        </div>
        <div class="suite-tags"></div>
        <div class="suite-steps-count">-</div>
        <div class="suite-result fail">error</div>
      </div>`;
  }

  const tags = suite.tags.map(t => {
    const tagClass = t === "smoke" ? "smoke" : t === "crud" ? "crud" : t === "auth" ? "auth" : t === "destructive" ? "destructive" : "";
    return `<span class="tag-pill ${tagClass}">${escapeHtml(t)}</span>`;
  }).join("");

  const total = suite.runResult
    ? suite.runResult.passed + suite.runResult.failed + suite.runResult.skipped
    : 0;

  let resultHtml: string;
  if (suite.status === "passed") {
    resultHtml = `<div class="suite-result pass">${suite.runResult!.passed}/${total} &#10003;</div>`;
  } else if (suite.status === "failed") {
    resultHtml = `<div class="suite-result fail">${suite.runResult!.passed}/${total} &#10007;</div>`;
  } else {
    resultHtml = `<div class="suite-result not-run">not run</div>`;
  }

  return `
    <div class="suite-row"
      onclick="var d=document.getElementById('${detailId}');d.style.display=d.style.display==='none'?'block':'none'">
      <div class="suite-info">
        <div class="suite-name">${escapeHtml(suite.name)}</div>
        ${suite.description ? `<div class="suite-desc">${escapeHtml(suite.description)}</div>` : ""}
      </div>
      <div class="suite-tags">${tags}</div>
      <div class="suite-steps-count">${suite.stepCount} steps</div>
      ${resultHtml}
    </div>
    <div class="suite-detail" id="${detailId}" style="display:none">
      <div style="font-size:0.75rem;color:var(--text-dim);font-family:var(--font-mono);">${escapeHtml(fileName)}</div>
    </div>`;
}
