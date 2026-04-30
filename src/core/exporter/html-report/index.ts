import type { RunRecord, StoredStepResult } from "../../../db/queries.ts";
import type { FailureClass } from "../../diagnostics/failure-class.ts";
import { escapeHtml, tryPrettyJson } from "./escape.ts";
import { buildCurl } from "./curl.ts";
import { STYLES } from "./styles.ts";
import { SCRIPT } from "./script.ts";

export interface RenderOptions {
  run: RunRecord;
  results: StoredStepResult[];
  zondVersion: string;
  generatedAt: Date;
  /** Optional collection name for the title. */
  collectionName?: string | null;
  /** Optional resolved base_url (currently best-effort from results). */
  baseUrl?: string | null;
}

const FAILURE_CLASS_META: Record<FailureClass, { label: string; cls: string; emoji: string }> = {
  definitely_bug: { label: "Definitely bug", cls: "fail", emoji: "🐞" },
  likely_bug: { label: "Likely bug", cls: "warn", emoji: "⚠️" },
  quirk: { label: "Quirk", cls: "info", emoji: "·" },
  env_issue: { label: "Env issue", cls: "info", emoji: "🌐" },
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pass: { label: "PASS", cls: "solid-pass" },
  fail: { label: "FAIL", cls: "solid-fail" },
  error: { label: "ERROR", cls: "solid-fail" },
  skip: { label: "SKIP", cls: "" },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function pickBaseUrl(results: StoredStepResult[]): string | null {
  for (const r of results) {
    if (!r.request_url) continue;
    try {
      const u = new URL(r.request_url);
      return `${u.protocol}//${u.host}`;
    } catch {
      // not absolute
    }
  }
  return null;
}

interface CoverageRow {
  endpoint: string;
  buckets: Record<string, "ok" | "4xx" | "5xx" | "err" | undefined>;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function buildCoverage(results: StoredStepResult[]): CoverageRow[] {
  // Group by request_url path × method, pick worst observed status per cell.
  const rows = new Map<string, CoverageRow>();
  for (const r of results) {
    if (!r.request_url || !r.request_method) continue;
    let path: string;
    try {
      path = new URL(r.request_url).pathname;
    } catch {
      path = r.request_url;
    }
    const method = r.request_method.toUpperCase();
    if (!METHODS.includes(method as typeof METHODS[number])) continue;
    let row = rows.get(path);
    if (!row) {
      row = { endpoint: path, buckets: {} };
      rows.set(path, row);
    }
    const status = r.response_status;
    let cell: "ok" | "4xx" | "5xx" | "err";
    if (r.status === "error" || status == null) cell = "err";
    else if (status >= 500) cell = "5xx";
    else if (status >= 400) cell = "4xx";
    else cell = "ok";
    const existing = row.buckets[method];
    // Worst-of-cell precedence: err/5xx > 4xx > ok
    const rank = { ok: 0, "4xx": 1, "5xx": 2, err: 3 } as const;
    if (!existing || rank[cell] > rank[existing]) {
      row.buckets[method] = cell;
    }
  }
  return [...rows.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

function badgeForStatus(status: number | null): string {
  if (status == null) return `<span class="badge fail">no resp</span>`;
  const cls = status >= 500 ? "fail" : status >= 400 ? "warn" : "pass";
  return `<span class="badge ${cls}">${status}</span>`;
}

function failureClassBadge(fc: FailureClass | null, reason: string | null): string {
  if (!fc) return "";
  const meta = FAILURE_CLASS_META[fc];
  const title = reason ? ` title="${escapeHtml(reason)}"` : "";
  return `<span class="badge ${meta.cls}"${title}>${meta.emoji} ${meta.label}</span>`;
}

function renderProvenance(prov: StoredStepResult["provenance"]): string {
  if (!prov) return "";
  const parts: string[] = [];
  if (prov.type) parts.push(`<span class="badge">${escapeHtml(prov.type)}</span>`);
  if (prov.generator) parts.push(`<span class="mono" style="font-size:11px;color:var(--fg-muted)">${escapeHtml(prov.generator)}</span>`);
  if (prov.endpoint) parts.push(`<span class="mono" style="font-size:11px">${escapeHtml(prov.endpoint)}</span>`);
  if (prov.response_branch) parts.push(`<span class="badge info">→ ${escapeHtml(prov.response_branch)}</span>`);
  return parts.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px">${parts.join("")}</div>` : "";
}

function renderSpecSnippet(pointer: string | null, excerpt: string | null): string {
  if (!pointer && !excerpt) return "";
  const ptrBlock = pointer
    ? `<div class="code-label">Spec pointer</div><pre class="code">${escapeHtml(pointer)}</pre>`
    : "";
  const exBlock = excerpt
    ? `<div class="code-label">Spec excerpt</div><pre class="code" data-lang="json">${escapeHtml(tryPrettyJson(excerpt))}</pre>`
    : "";
  return ptrBlock + exBlock;
}

function renderAssertions(asserts: StoredStepResult["assertions"]): string {
  if (asserts.length === 0) {
    return `<div class="empty" style="padding:16px">No assertions recorded.</div>`;
  }
  return `<ul class="asserts">${asserts.map((a) => {
    const cls = a.passed ? "passed" : "failed";
    const expected = a.expected !== undefined ? escapeHtml(JSON.stringify(a.expected)) : "";
    const actual = a.actual !== undefined ? escapeHtml(JSON.stringify(a.actual)) : "";
    const diff = !a.passed && (a.expected !== undefined || a.actual !== undefined)
      ? `<div class="a-diff">
           <div><span class="lbl">expected:</span> ${expected}</div>
           <div><span class="lbl">actual:</span> ${actual}</div>
         </div>`
      : "";
    return `<li class="${cls}">
      <div class="a-head">
        <span class="badge ${a.passed ? "pass" : "fail"} dot">${escapeHtml(a.rule || "assertion")}</span>
        ${a.field ? `<span class="mono" style="font-size:11px;color:var(--fg-muted)">${escapeHtml(a.field)}</span>` : ""}
      </div>
      ${diff}
    </li>`;
  }).join("")}</ul>`;
}

function renderHeaders(rawJson: string | null): string {
  if (!rawJson) return `<div class="empty" style="padding:16px">No headers.</div>`;
  return `<pre class="code" data-lang="json">${escapeHtml(tryPrettyJson(rawJson))}</pre>`;
}

function renderBody(label: string, content: string | null): string {
  if (!content) return `<div class="code-label">${label}</div><div class="empty" style="padding:12px;font-size:11px">empty</div>`;
  const isJson = (() => { try { JSON.parse(content); return true; } catch { return false; } })();
  const lang = isJson ? "json" : "text";
  const display = isJson ? tryPrettyJson(content) : content;
  return `<div class="code-label">${label}</div><pre class="code" data-lang="${lang}">${escapeHtml(display)}</pre>`;
}

function buildIssueMarkdown(step: StoredStepResult, run: RunRecord): string {
  const fc = step.failure_class ? FAILURE_CLASS_META[step.failure_class].label : "Unclassified";
  const lines: string[] = [];
  lines.push(`## ${step.test_name}`);
  lines.push("");
  lines.push(`**Endpoint:** \`${step.request_method ?? "?"} ${step.request_url ?? "?"}\`  `);
  lines.push(`**Status:** ${step.response_status ?? "—"} · **Result:** ${step.status} · **Class:** ${fc}`);
  if (step.failure_class_reason) {
    lines.push(`**Reason:** ${step.failure_class_reason}`);
  }
  lines.push(`**Run:** zond run #${run.id} (${run.started_at})`);
  lines.push("");
  lines.push("### Reproduce");
  lines.push("```sh");
  lines.push(buildCurl(step));
  lines.push("```");
  if (step.response_body) {
    lines.push("");
    lines.push("### Response body");
    lines.push("```json");
    lines.push(tryPrettyJson(step.response_body));
    lines.push("```");
  }
  if (step.spec_pointer) {
    lines.push("");
    lines.push(`**OpenAPI pointer:** \`${step.spec_pointer}\``);
  }
  const failedA = step.assertions.filter((a) => !a.passed);
  if (failedA.length > 0) {
    lines.push("");
    lines.push("### Failed assertions");
    for (const a of failedA) {
      lines.push(`- \`${a.rule}\` at \`${a.field}\`: expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(a.actual)}`);
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("_Generated by [zond](https://github.com/anthropics/zond)._");
  return lines.join("\n");
}

function renderFailureCard(step: StoredStepResult, run: RunRecord): string {
  const method = (step.request_method ?? "—").toUpperCase();
  const fcKey = step.failure_class ?? "unclassified";
  const curl = buildCurl(step);
  const issueMd = buildIssueMarkdown(step, run);

  return `<li class="card" data-fclass="${escapeHtml(fcKey)}">
    <button type="button" class="head">
      <svg class="chev" viewBox="0 0 16 16" fill="currentColor"><path d="M5.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06L6.28 11.78a.75.75 0 0 1-1.06-1.06L7.94 8 5.22 5.28a.75.75 0 0 1 0-1.06Z"/></svg>
      <span class="method ${method}">${escapeHtml(method)}</span>
      <span class="name" title="${escapeHtml(step.test_name)}">${escapeHtml(step.test_name)}</span>
      <span class="badges">
        ${failureClassBadge(step.failure_class, step.failure_class_reason)}
        ${badgeForStatus(step.response_status)}
        <span class="badge ${STATUS_LABEL[step.status]?.cls ?? ""}">${STATUS_LABEL[step.status]?.label ?? step.status}</span>
      </span>
    </button>
    <div class="body">
      <div class="actions">
        <button class="btn" data-copy="curl">📋 Copy curl</button>
        <button class="btn" data-copy="issue">🐙 Copy as GitHub issue</button>
      </div>
      <div class="tabs">
        <button class="active" data-tab="response">Response</button>
        <button data-tab="request">Request</button>
        <button data-tab="assertions">Assertions (${step.assertions.length})</button>
        <button data-tab="source">Source</button>
      </div>
      <div class="panel active" data-tab="response">
        <dl class="kv">
          <dt>Status</dt><dd>${step.response_status ?? "—"}</dd>
          <dt>Duration</dt><dd>${formatDuration(step.duration_ms)}</dd>
          ${step.error_message ? `<dt>Error</dt><dd style="color:var(--fail)">${escapeHtml(step.error_message)}</dd>` : ""}
        </dl>
        <div class="code-label">Headers</div>${renderHeaders(step.response_headers)}
        ${renderBody("Body", step.response_body)}
      </div>
      <div class="panel" data-tab="request">
        <dl class="kv">
          <dt>Method</dt><dd class="mono">${escapeHtml(method)}</dd>
          <dt>URL</dt><dd class="mono">${escapeHtml(step.request_url ?? "—")}</dd>
        </dl>
        ${renderBody("Body", step.request_body)}
      </div>
      <div class="panel" data-tab="assertions">${renderAssertions(step.assertions)}</div>
      <div class="panel" data-tab="source">
        ${renderProvenance(step.provenance)}
        ${renderSpecSnippet(step.spec_pointer, step.spec_excerpt)}
        ${!step.provenance && !step.spec_pointer && !step.spec_excerpt ? `<div class="empty" style="padding:16px">No source metadata recorded.</div>` : ""}
      </div>
      <pre data-payload="curl" hidden>${escapeHtml(curl)}</pre>
      <pre data-payload="issue" hidden>${escapeHtml(issueMd)}</pre>
    </div>
  </li>`;
}

function renderRing(passRate: number, totalLabel: string): string {
  const r = 56;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - passRate / 100);
  const color = passRate >= 90 ? "var(--pass)" : passRate >= 60 ? "var(--warn)" : "var(--fail)";
  return `<div class="ring">
    <svg viewBox="0 0 140 140">
      <circle class="track" cx="70" cy="70" r="${r}" fill="none" stroke-width="12"/>
      <circle class="fill" cx="70" cy="70" r="${r}" fill="none" stroke-width="12"
        stroke="${color}" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
    </svg>
    <div class="label"><div class="pct">${passRate.toFixed(0)}%</div><div class="lbl">${totalLabel}</div></div>
  </div>`;
}

function renderCoverage(rows: CoverageRow[]): string {
  if (rows.length === 0) return "";
  const cellCls: Record<NonNullable<CoverageRow["buckets"][string]>, string> = {
    ok: "s2",
    "4xx": "s4",
    "5xx": "s5",
    err: "serr",
  };
  const cellLabel: Record<NonNullable<CoverageRow["buckets"][string]>, string> = {
    ok: "2xx",
    "4xx": "4xx",
    "5xx": "5xx",
    err: "ERR",
  };
  const header = `<div class="cov-row">
    <div class="cov-cell head path">Endpoint</div>
    ${METHODS.map((m) => `<div class="cov-cell head">${m}</div>`).join("")}
  </div>`;
  const body = rows.map((row) => {
    const cells = METHODS.map((m) => {
      const v = row.buckets[m];
      return v
        ? `<div class="cov-cell ${cellCls[v]}">${cellLabel[v]}</div>`
        : `<div class="cov-cell empty">·</div>`;
    }).join("");
    return `<div class="cov-row"><div class="cov-cell path mono" title="${escapeHtml(row.endpoint)}">${escapeHtml(row.endpoint)}</div>${cells}</div>`;
  }).join("");
  return `<section>
    <h2>Coverage map <span class="count">${rows.length} endpoint${rows.length === 1 ? "" : "s"} touched</span></h2>
    <div class="cov-grid">${header}${body}</div>
  </section>`;
}

export function renderHtmlReport(opts: RenderOptions): string {
  const { run, results, zondVersion, generatedAt, collectionName } = opts;
  const failures = results.filter((r) => r.status !== "pass" && r.status !== "skip");
  const passed = results.filter((r) => r.status === "pass").length;
  const total = results.length;
  const passRate = total > 0 ? (passed / total) * 100 : 0;
  const baseUrl = opts.baseUrl ?? pickBaseUrl(results);
  const errored = results.filter((r) => r.status === "error").length;
  const coverage = buildCoverage(results);

  // Failure-class breakdown
  const fcCounts: Record<string, number> = {};
  for (const f of failures) {
    const k = f.failure_class ?? "unclassified";
    fcCounts[k] = (fcCounts[k] ?? 0) + 1;
  }
  const fcKeys = Object.keys(fcCounts);

  const title = collectionName
    ? `${collectionName} · Run #${run.id}`
    : `zond Run #${run.id}`;

  const filterButtons = `<div class="filters">
    <button class="active" data-filter="all">All (${failures.length})</button>
    ${fcKeys.map((k) => {
      const meta = k === "unclassified"
        ? { label: "Unclassified", emoji: "?" }
        : { label: FAILURE_CLASS_META[k as FailureClass].label, emoji: FAILURE_CLASS_META[k as FailureClass].emoji };
      return `<button data-filter="${escapeHtml(k)}">${meta.emoji} ${meta.label} (${fcCounts[k]})</button>`;
    }).join("")}
  </div>`;

  const failuresSection = failures.length === 0
    ? `<section>
        <h2>Failures</h2>
        <div class="empty">🎉 All ${total} step${total === 1 ? "" : "s"} passed — nothing to investigate.</div>
      </section>`
    : `<section>
        <h2>Failures <span class="count">${failures.length} of ${total} step${total === 1 ? "" : "s"}</span></h2>
        ${fcKeys.length > 0 ? filterButtons : ""}
        <ul class="cards">
          ${failures.map((f) => renderFailureCard(f, run)).join("")}
        </ul>
      </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="generator" content="zond ${escapeHtml(zondVersion)}">
<style>${STYLES}</style>
</head>
<body>
<div class="container">
  <header class="hero">
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="sub">${escapeHtml(run.environment ?? "no environment")} ${baseUrl ? `· <span class="mono">${escapeHtml(baseUrl)}</span>` : ""}</div>
      <dl class="meta">
        <div><dt>Started</dt><dd>${formatDate(run.started_at)}</dd></div>
        <div><dt>Finished</dt><dd>${formatDate(run.finished_at)}</dd></div>
        <div><dt>Duration</dt><dd>${formatDuration(run.duration_ms)}</dd></div>
        <div><dt>Trigger</dt><dd>${escapeHtml(run.trigger ?? "—")}</dd></div>
        <div><dt>Branch</dt><dd>${escapeHtml(run.branch ?? "—")}</dd></div>
        <div><dt>Commit</dt><dd class="mono">${escapeHtml(run.commit_sha?.slice(0, 8) ?? "—")}</dd></div>
      </dl>
    </div>
    ${renderRing(passRate, total === 0 ? "no tests" : `${passed}/${total} pass`)}
  </header>

  <div class="kpis">
    <div class="kpi"><div class="n">${total}</div><div class="l">Total</div></div>
    <div class="kpi pass"><div class="n">${passed}</div><div class="l">Passed</div></div>
    <div class="kpi fail"><div class="n">${run.failed}</div><div class="l">Failed</div></div>
    ${errored > 0 ? `<div class="kpi warn"><div class="n">${errored}</div><div class="l">Errored</div></div>` : ""}
    ${run.skipped > 0 ? `<div class="kpi"><div class="n">${run.skipped}</div><div class="l">Skipped</div></div>` : ""}
  </div>

  ${failuresSection}
  ${renderCoverage(coverage)}

  <footer>
    <span>zond <span class="mono">${escapeHtml(zondVersion)}</span> · generated ${escapeHtml(generatedAt.toISOString())}</span>
    <span><a href="https://github.com/anthropics/zond">github.com/anthropics/zond</a></span>
  </footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
