import { escapeHtml } from "./layout.ts";
import { formatDuration } from "../../core/reporter/console.ts";
import type { StoredStepResult } from "../../db/queries.ts";

export function statusBadge(total: number, passed: number, failed: number): string {
  if (total === 0) return `<span class="badge badge-skip">empty</span>`;
  if (failed > 0) return `<span class="badge badge-fail">fail</span>`;
  return `<span class="badge badge-pass">pass</span>`;
}

export function stepStatusBadge(status: string): string {
  switch (status) {
    case "pass":
      return `<span class="badge badge-pass">&#10003;</span>`;
    case "fail":
      return `<span class="badge badge-fail">&#10007;</span>`;
    case "skip":
      return `<span class="badge badge-skip">&#9675;</span>`;
    case "error":
      return `<span class="badge badge-error">&#10007;</span>`;
    default:
      return `<span class="badge">${escapeHtml(status)}</span>`;
  }
}

export function methodBadge(method: string): string {
  const m = method.toLowerCase();
  return `<span class="badge-method method-${m}">${method}</span>`;
}

/**
 * Render grouped suite results with step details, captures, and chain visualization.
 * Used by both the dashboard panels and the /runs/:id detail page.
 */
export function renderSuiteResults(
  results: StoredStepResult[],
  runId: number,
  options?: { idPrefix?: string; suiteMetadata?: Map<string, { description?: string; tags?: string[] }> },
): string {
  const prefix = options?.idPrefix ?? `r${runId}`;

  // Group by suite
  const suites = new Map<string, StoredStepResult[]>();
  for (const r of results) {
    const list = suites.get(r.suite_name) ?? [];
    list.push(r);
    suites.set(r.suite_name, list);
  }

  // Build capture source map
  const captureSourceMap = new Map<string, string>();
  for (const [, steps] of suites) {
    for (const step of steps) {
      if (step.captures && typeof step.captures === "object") {
        for (const varName of Object.keys(step.captures)) {
          captureSourceMap.set(varName, step.test_name);
        }
      }
    }
  }

  let suitesHtml = "";
  for (const [suiteName, steps] of suites) {
    const suiteHasCaptures = steps.some(s =>
      s.captures && typeof s.captures === "object" && Object.keys(s.captures).length > 0,
    );
    const isChainSuite = suiteHasCaptures || suiteName.endsWith("CRUD");

    const stepsHtml = steps
      .map((step, i) => {
        const detailId = `detail-${prefix}-${i}`;
        const hasFailed = step.status === "fail" || step.status === "error";

        let capturesHtml = "";
        if (step.captures && typeof step.captures === "object") {
          const captureEntries = Object.entries(step.captures);
          if (captureEntries.length > 0) {
            capturesHtml = captureEntries.map(([k, v]) =>
              `<span class="capture-badge">${escapeHtml(k)} = ${escapeHtml(String(v))}</span>`,
            ).join(" ");
          }
        }

        let assertionsHtml = "";
        if (step.assertions.length > 0) {
          const items = step.assertions
            .map(
              (a) =>
                `<li class="${a.passed ? "assertion-pass" : "assertion-fail"}">${escapeHtml(a.field)}: ${escapeHtml(a.rule)} (got ${escapeHtml(String(a.actual))})</li>`,
            )
            .join("");
          assertionsHtml = `<ul class="assertion-list">${items}</ul>`;
        }

        let requestHtml = "";
        if (step.request_method) {
          requestHtml = `<div><strong>Request:</strong> ${escapeHtml(step.request_method)} ${escapeHtml(step.request_url ?? "")}</div>`;
        }

        let reqBodyHtml = "";
        if (step.request_body) {
          reqBodyHtml = `<details class="body-details"><summary>Request Body</summary><pre>${escapeHtml(step.request_body)}</pre></details>`;
        }
        let resBodyHtml = "";
        if (step.response_body) {
          resBodyHtml = `<details class="body-details"><summary>Response Body</summary><pre>${escapeHtml(step.response_body)}</pre></details>`;
        }

        let errorHtml = "";
        if (step.error_message) {
          errorHtml = `<div><strong>Error:</strong> ${escapeHtml(step.error_message)}</div>`;
        }

        let skipReasonHtml = "";
        if (step.status === "skip" && step.error_message) {
          const match = step.error_message.match(/Depends on missing capture: (\w+)/);
          if (match) {
            const depVar = match[1]!;
            const sourceStep = captureSourceMap.get(depVar);
            skipReasonHtml = sourceStep
              ? `<div class="skip-reason">Skipped: depends on <code>${escapeHtml(depVar)}</code> (from step "${escapeHtml(sourceStep)}")</div>`
              : `<div class="skip-reason">Skipped: depends on <code>${escapeHtml(depVar)}</code></div>`;
          }
        }

        const hasContent = requestHtml || errorHtml || skipReasonHtml || assertionsHtml || reqBodyHtml || resBodyHtml;
        const detailPanel = hasContent
          ? `<div class="detail-panel" id="${detailId}" style="display:none">
              ${requestHtml}
              ${errorHtml}
              ${skipReasonHtml}
              ${assertionsHtml}
              ${reqBodyHtml}
              ${resBodyHtml}
            </div>`
          : "";

        const toggle = hasContent
          ? `onclick="var d=document.getElementById('${detailId}');d.style.display=d.style.display==='none'?'block':'none'"`
          : "";

        const chainedClass = isChainSuite ? " chained" : "";
        const statusClass = (step.status === "fail" || step.status === "error") ? ` step-${step.status}` : "";

        return `
          <div class="step-row${chainedClass}${statusClass}" ${toggle}>
            <div>${stepStatusBadge(step.status)}</div>
            <div class="step-name">${step.request_method && step.request_url ? (() => { let p: string; try { p = new URL(step.request_url).pathname; } catch { p = step.request_url; } const sc = step.response_status ? ` <span class="step-status-code ${step.response_status >= 400 ? "status-error" : "status-ok"}">${step.response_status}</span>` : ""; return `${methodBadge(step.request_method)} <span class="step-path">${escapeHtml(p)}</span>${sc} <span class="step-name-dim">${escapeHtml(step.test_name)}</span>`; })() : escapeHtml(step.test_name)}${capturesHtml ? ` ${capturesHtml}` : ""}</div>
            <div class="step-duration">${formatDuration(step.duration_ms)}</div>
          </div>
          ${detailPanel}`;
      })
      .join("");

    const chainClass = isChainSuite ? " chain-suite" : "";

    const meta = options?.suiteMetadata?.get(suiteName);
    const descriptionHtml = meta?.description
      ? `<p class="suite-description">${escapeHtml(meta.description)}</p>`
      : "";
    const tagsHtml = meta?.tags?.length
      ? `<div class="suite-tags">${meta.tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join(" ")}</div>`
      : "";

    suitesHtml += `
      <div class="suite-section${chainClass}">
        <h3>${escapeHtml(suiteName)}</h3>
        ${descriptionHtml}
        ${tagsHtml}
        ${isChainSuite ? '<div class="chain-connector">' : ""}
        ${stepsHtml}
        ${isChainSuite ? "</div>" : ""}
      </div>`;
  }

  return suitesHtml;
}

/**
 * Render the "show only failed" toggle + auto-expand failed steps script.
 */
export function failedFilterToggle(): string {
  return `
    <label class="failed-filter-toggle" style="display:inline-flex;align-items:center;gap:0.5rem;font-size:0.85rem;cursor:pointer;">
      <input type="checkbox" id="failed-only-toggle" onchange="
        var on = this.checked;
        document.querySelectorAll('.step-row').forEach(function(el) {
          if (on && !el.classList.contains('step-fail') && !el.classList.contains('step-error')) {
            el.style.display = 'none';
            var next = el.nextElementSibling;
            if (next && next.classList.contains('detail-panel')) next.style.display = 'none';
          } else {
            el.style.display = '';
          }
        });
      "> Show only failed
    </label>`;
}

/**
 * Script to auto-expand failed step detail panels on page load.
 */
export function autoExpandFailedScript(): string {
  return `<script>
    document.querySelectorAll('.step-row.step-fail, .step-row.step-error').forEach(function(el) {
      var next = el.nextElementSibling;
      if (next && next.classList.contains('detail-panel')) next.style.display = 'block';
    });
  </script>`;
}
