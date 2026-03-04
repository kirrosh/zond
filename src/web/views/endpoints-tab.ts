/**
 * Endpoints tab: all spec endpoints with coverage status, warnings, filters.
 */

import type { CollectionState, EndpointViewState, CoveringStep } from "../data/collection-state.ts";
import { escapeHtml } from "./layout.ts";
import { methodBadge } from "./results.ts";
import { basename } from "node:path";

export function renderEndpointsTab(state: CollectionState, filters?: { status?: string; method?: string }): string {
  if (state.totalEndpoints === 0) {
    return `<div class="tab-empty">No OpenAPI spec configured. Register a spec with <code>setup_api</code> to see endpoints.</div>`;
  }

  let filtered = state.endpoints;
  if (filters?.status) {
    filtered = filtered.filter(ep => {
      if (filters.status === "passing") return ep.runStatus === "passing";
      if (filters.status === "failing") return ep.runStatus === "api_error" || ep.runStatus === "test_failed";
      if (filters.status === "no_tests") return ep.runStatus === "no_tests";
      if (filters.status === "not_run") return ep.runStatus === "not_run";
      return true;
    });
  }
  if (filters?.method) {
    filtered = filtered.filter(ep => ep.method === filters.method);
  }

  const collectionId = state.collection.id;

  // Filter bar
  const counts = {
    all: state.endpoints.length,
    passing: state.endpoints.filter(e => e.runStatus === "passing").length,
    failing: state.endpoints.filter(e => e.runStatus === "api_error" || e.runStatus === "test_failed").length,
    no_tests: state.endpoints.filter(e => e.runStatus === "no_tests").length,
    not_run: state.endpoints.filter(e => e.runStatus === "not_run").length,
  };

  const filterBar = `
    <div class="filter-bar">
      <button class="filter-chip ${!filters?.status ? 'filter-active' : ''}"
        hx-get="/panels/endpoints?collection_id=${collectionId}"
        hx-target="#tab-content" hx-swap="innerHTML">All (${counts.all})</button>
      <button class="filter-chip filter-chip-pass ${filters?.status === 'passing' ? 'filter-active' : ''}"
        hx-get="/panels/endpoints?collection_id=${collectionId}&status=passing"
        hx-target="#tab-content" hx-swap="innerHTML">Passing (${counts.passing})</button>
      <button class="filter-chip filter-chip-fail ${filters?.status === 'failing' ? 'filter-active' : ''}"
        hx-get="/panels/endpoints?collection_id=${collectionId}&status=failing"
        hx-target="#tab-content" hx-swap="innerHTML">Failing (${counts.failing})</button>
      <button class="filter-chip filter-chip-notrun ${filters?.status === 'not_run' ? 'filter-active' : ''}"
        hx-get="/panels/endpoints?collection_id=${collectionId}&status=not_run"
        hx-target="#tab-content" hx-swap="innerHTML">Not Run (${counts.not_run})</button>
      <button class="filter-chip filter-chip-notest ${filters?.status === 'no_tests' ? 'filter-active' : ''}"
        hx-get="/panels/endpoints?collection_id=${collectionId}&status=no_tests"
        hx-target="#tab-content" hx-swap="innerHTML">No Tests (${counts.no_tests})</button>
    </div>`;

  const rows = filtered.map((ep, i) => renderEndpointRow(ep, collectionId, i)).join("");

  return `${filterBar}<div class="endpoint-list">${rows}</div>`;
}

function renderEndpointRow(ep: EndpointViewState, collectionId: number, index: number): string {
  const statusDot = getStatusDot(ep.runStatus);
  const warningBadges = renderWarningBadges(ep.warnings);
  const detailId = `ep-detail-${index}`;

  return `
    <div class="endpoint-row" onclick="var d=document.getElementById('${detailId}');d.style.display=d.style.display==='none'?'grid':'none'">
      <span class="endpoint-status">${statusDot}</span>
      <span class="endpoint-method">${methodBadge(ep.method)}</span>
      <span class="endpoint-path">${escapeHtml(ep.path)}</span>
      <span class="endpoint-badges">${warningBadges}${ep.summary ? `<span class="endpoint-summary">${escapeHtml(ep.summary)}</span>` : ""}</span>
    </div>
    <div class="endpoint-detail" id="${detailId}" style="display:none">
      ${renderEndpointDetail(ep)}
    </div>`;
}

function getStatusDot(status: EndpointViewState["runStatus"]): string {
  switch (status) {
    case "passing": return '<span class="status-dot status-pass" title="Tests passing"></span>';
    case "api_error": return '<span class="status-dot status-fail" title="API error (5xx)"></span>';
    case "test_failed": return '<span class="status-dot status-fail" title="Assertion failed"></span>';
    case "not_run": return '<span class="status-dot status-notrun" title="Tests exist, not run"></span>';
    case "no_tests": return '<span class="status-dot status-notest" title="No tests"></span>';
  }
}

function renderWarningBadges(warnings: string[]): string {
  return warnings.map(w => {
    if (w === "deprecated") return '<span class="warning-badge warning-deprecated">DEPRECATED</span>';
    if (w === "no_response_schema") return '<span class="warning-badge warning-schema">NO SCHEMA</span>';
    if (w === "no_responses_defined") return '<span class="warning-badge warning-schema">NO RESPONSES</span>';
    if (w.startsWith("required_params_no_examples")) return '<span class="warning-badge warning-params">MISSING EXAMPLES</span>';
    return `<span class="warning-badge">${escapeHtml(w)}</span>`;
  }).join(" ");
}

function renderEndpointDetail(ep: EndpointViewState): string {
  if (!ep.hasCoverage) {
    return `<div class="ep-detail-section"><em style="color:var(--text-dim);">No test files cover this endpoint</em></div>`;
  }

  // If we have run results, show covering steps
  if (ep.coveringSteps.length > 0) {
    const steps = ep.coveringSteps.map(step => {
      const icon = step.status === "pass"
        ? '<span class="step-icon pass">&#10003;</span>'
        : step.status === "fail" || step.status === "error"
          ? '<span class="step-icon fail">&#10007;</span>'
          : step.status === "skip"
            ? '<span class="step-icon skip">&#9644;</span>'
            : '<span class="step-icon" style="color:var(--text-dim);">&#9675;</span>';

      const statusBadge = step.responseStatus && step.responseStatus >= 400 && (step.status === "fail" || step.status === "error")
        ? ` <span class="warning-badge server-error" style="font-size:0.6rem;">${step.responseStatus} ${httpStatusText(step.responseStatus)}</span>`
        : "";

      const duration = step.durationMs != null ? `<span class="step-duration">${step.durationMs}ms</span>` : "";

      let assertionsHtml = "";
      if (step.assertions && step.assertions.length > 0) {
        assertionsHtml = `<div style="padding-left:1.5rem;margin-top:0.25rem;">` +
          step.assertions.map(a => {
            const aIcon = a.passed
              ? '<span class="assertion-icon pass">&#10003;</span>'
              : '<span class="assertion-icon fail">&#10007;</span>';
            const actual = !a.passed && a.actual !== undefined
              ? ` <span class="assertion-actual">(got ${JSON.stringify(a.actual)})</span>` : "";
            return `<div class="assertion-row">${aIcon} <span class="assertion-field">${escapeHtml(a.field)}:</span> <span class="assertion-rule">${escapeHtml(a.rule)}</span>${actual}</div>`;
          }).join("") + `</div>`;
      }

      let hintHtml = "";
      if (step.hint) {
        hintHtml = `<div class="failure-hint"><span>&#9888;</span> ${escapeHtml(step.hint)}</div>`;
      }

      return `<div class="covering-suite">
        ${icon}
        <span class="suite-ref">${escapeHtml(step.file)}</span>
        <span class="dim" style="font-size:0.75rem;">&rarr; "${escapeHtml(step.stepName)}"</span>
        <span style="margin-left:auto;display:flex;align-items:center;gap:0.5rem;">${statusBadge}${duration}</span>
      </div>${assertionsHtml}${hintHtml}`;
    }).join("");
    return steps;
  }

  // Fallback: just file names
  const files = ep.coveringFiles.map(f =>
    `<div class="covering-suite">
      <span class="step-icon" style="color:var(--text-dim);">&#9675;</span>
      <span class="suite-ref">${escapeHtml(basename(f))}</span>
      <span class="dim" style="font-size:0.75rem;">not run</span>
    </div>`
  ).join("");
  return files;
}

function httpStatusText(code: number): string {
  const map: Record<number, string> = {
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
    405: "Method Not Allowed", 409: "Conflict", 422: "Unprocessable Entity",
    429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway",
    503: "Service Unavailable", 504: "Gateway Timeout",
  };
  return map[code] ?? "";
}
