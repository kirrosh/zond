/**
 * Suites tab: all YAML files on disk with run status and step details.
 */

import type { CollectionState, SuiteViewState, StepViewState } from "../data/collection-state.ts";
import { escapeHtml } from "./layout.ts";
import { methodBadge } from "./results.ts";
import { basename } from "node:path";

export function renderSuitesTab(state: CollectionState): string {
  if (state.suites.length === 0) {
    return `<div class="tab-empty">No test suites found on disk. Generate tests with <code>zond guide</code> or use the test-generation skill.</div>`;
  }

  const rows = state.suites.map((s, i) => renderSuiteRow(s, i)).join("");
  return `<div class="suite-list">${rows}</div>`;
}

function renderSuiteRow(suite: SuiteViewState, index: number): string {
  const detailId = `suite-detail-${index}`;

  if (suite.status === "parse_error") {
    return `
      <div class="suite-row suite-error-row">
        <div class="suite-info">
          <div class="suite-name">${escapeHtml(basename(suite.filePath || suite.name))}</div>
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

  // Step detail rows
  const stepsHtml = suite.steps.length > 0
    ? suite.steps.map((step, si) => renderStepRow(step, index, si)).join("")
    : `<div style="font-size:0.75rem;color:var(--text-dim);padding:0.5rem;">No run results yet</div>`;

  return `
    <div class="suite-row" data-suite-name="${escapeHtml(suite.name)}"
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
      ${stepsHtml}
    </div>`;
}

function renderStepRow(step: StepViewState, suiteIdx: number, stepIdx: number): string {
  const icon = step.status === "pass"
    ? '<span class="step-icon pass">&#10003;</span>'
    : step.status === "fail" || step.status === "error"
      ? '<span class="step-icon fail">&#10007;</span>'
      : '<span class="step-icon skip">&#9675;</span>';

  const labelStyle = step.status === "fail" || step.status === "error"
    ? ' style="color:var(--fail);"'
    : step.status === "skip"
      ? ' style="color:var(--skip);"'
      : "";

  const duration = step.durationMs != null
    ? `<span class="step-duration">${step.durationMs}ms</span>`
    : `<span class="step-duration">-</span>`;

  // Primary label: prefer METHOD /path [status] over step name
  let primaryLabel: string;
  let nameLabel = "";
  if (step.requestMethod && step.requestUrl) {
    let urlPath: string;
    try { urlPath = new URL(step.requestUrl).pathname; } catch { urlPath = step.requestUrl; }
    const statusTag = step.responseStatus
      ? ` <span class="step-status-code ${step.responseStatus >= 400 ? "status-error" : "status-ok"}">${step.responseStatus}</span>`
      : "";
    primaryLabel = `${methodBadge(step.requestMethod)} <span class="step-path">${escapeHtml(urlPath)}</span>${statusTag}`;
    nameLabel = ` <span class="step-name-dim">${escapeHtml(step.name)}</span>`;
  } else {
    primaryLabel = escapeHtml(step.name);
  }

  // Captures
  const captureHtml = step.captures && Object.keys(step.captures).length > 0
    ? `<span class="step-captures">${Object.entries(step.captures).map(([k, v]) =>
        `<span class="capture-pill">${escapeHtml(k)} = ${escapeHtml(String(v))}</span>`
      ).join("")}</span>`
    : `<span class="step-captures"></span>`;

  const detailId = `s-${suiteIdx}-step-${stepIdx}`;
  const hasDetail =
    (step.assertions && step.assertions.length > 0) ||
    step.hint ||
    step.responseBody ||
    step.requestBody ||
    step.errorMessage ||
    (step.requestMethod && step.requestUrl);

  const clickHandler = hasDetail
    ? ` onclick="event.stopPropagation();var d=document.getElementById('${detailId}');d.style.display=d.style.display==='none'?'block':'none'"`
    : "";

  let detailPanel = "";
  if (hasDetail) {
    let detailContent = "";

    // Request info
    if (step.requestMethod && step.requestUrl) {
      detailContent += `<div style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text-dim);margin-bottom:0.4rem;">
        ${escapeHtml(step.requestMethod)} ${escapeHtml(step.requestUrl)}</div>`;
    }

    // Assertions
    if (step.assertions && step.assertions.length > 0) {
      detailContent += step.assertions.map(a => {
        const aIcon = a.passed
          ? '<span class="assertion-icon pass">&#10003;</span>'
          : '<span class="assertion-icon fail">&#10007;</span>';
        const actual = !a.passed && a.actual !== undefined
          ? ` <span class="assertion-actual">(got ${escapeHtml(JSON.stringify(a.actual))})</span>` : "";
        return `<div class="assertion-row">${aIcon} <span class="assertion-field">${escapeHtml(a.field)}:</span> <span class="assertion-rule">${escapeHtml(a.rule)}</span>${actual}</div>`;
      }).join("");
    }

    // Error message
    if (step.errorMessage) {
      detailContent += `<div style="font-family:var(--font-mono);font-size:0.75rem;color:var(--fail);margin-top:0.25rem;">${escapeHtml(step.errorMessage)}</div>`;
    }

    // Failure hint
    if (step.hint) {
      detailContent += `<div class="failure-hint"><span>&#9888;</span> ${escapeHtml(step.hint)}</div>`;
    }

    // Request body toggle
    if (step.requestBody) {
      const truncatedReq = step.requestBody.length > 2000 ? step.requestBody.slice(0, 2000) + "..." : step.requestBody;
      detailContent += `<div class="req-res-toggle" onclick="event.stopPropagation();var b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none'">&#9660; Request Body</div>
        <div class="req-res-body" style="display:none;"><pre style="font-size:0.7rem;margin:0.25rem 0;">${escapeHtml(truncatedReq)}</pre></div>`;
    }

    // Response body toggle
    if (step.responseBody) {
      const truncated = step.responseBody.length > 2000 ? step.responseBody.slice(0, 2000) + "..." : step.responseBody;
      detailContent += `<div class="req-res-toggle" onclick="event.stopPropagation();var b=this.nextElementSibling;b.style.display=b.style.display==='none'?'block':'none'">&#9660; Response Body</div>
        <div class="req-res-body" style="display:none;"><pre style="font-size:0.7rem;margin:0.25rem 0;">${escapeHtml(truncated)}</pre></div>`;
    }

    detailPanel = `<div class="step-detail-panel" id="${detailId}" style="display:none">${detailContent}</div>`;
  }

  return `<div class="step-row"${clickHandler}>
    ${icon}
    <span class="step-label"${labelStyle}>${primaryLabel}${nameLabel}</span>
    ${captureHtml}
    ${duration}
  </div>${detailPanel}`;
}
