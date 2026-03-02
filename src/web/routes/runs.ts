import { Hono } from "hono";
import { layout, escapeHtml } from "../views/layout.ts";
import { statusBadge, renderSuiteResults, failedFilterToggle, autoExpandFailedScript } from "../views/results.ts";
import { getRunById, getResultsByRunId, getCollectionById } from "../../db/queries.ts";
import { formatDuration } from "../../core/reporter/console.ts";

const runs = new Hono();

runs.get("/runs/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.html(layout("Not Found", "<h1>Invalid run ID</h1>"), 400);

  const run = getRunById(id);
  if (!run) return c.html(layout("Not Found", "<h1>Run not found</h1>"), 404);

  const results = getResultsByRunId(id);

  // Resolve test_path for re-run button
  const collection = run.collection_id ? getCollectionById(run.collection_id) : null;
  const rerunBtnHtml = collection
    ? `<button class="btn btn-sm btn-run"
        hx-post="/run"
        hx-vals='${escapeHtml(JSON.stringify({ path: collection.test_path, ...(run.environment ? { env: run.environment } : {}) }))}'
        hx-disabled-elt="this"
        style="margin-left:0.5rem;">Re-run</button>`
    : "";

  const headerHtml = `
    <h1>Run #${run.id}</h1>
    <div class="cards">
      <div class="card">
        <div class="card-label">Date</div>
        <div class="card-value" style="font-size:1rem">${escapeHtml(run.started_at)}</div>
      </div>
      <div class="card">
        <div class="card-label">Environment</div>
        <div class="card-value" style="font-size:1rem">${run.environment ? escapeHtml(run.environment) : "-"}</div>
      </div>
      <div class="card">
        <div class="card-label">Duration</div>
        <div class="card-value">${run.duration_ms != null ? formatDuration(run.duration_ms) : "-"}</div>
      </div>
      <div class="card">
        <div class="card-label">Results</div>
        <div class="card-value" style="font-size:1rem">${run.passed} &#10003; ${run.failed} &#10007; ${run.skipped} &#9675;</div>
      </div>
    </div>
    <div style="margin:0.5rem 0 1rem;">
      <a href="/api/export/${run.id}/junit" download class="btn btn-sm btn-outline">Export JUnit XML</a>
      <a href="/api/export/${run.id}/json" download class="btn btn-sm btn-outline" style="margin-left:0.5rem;">Export JSON</a>
      ${rerunBtnHtml}
    </div>`;

  const suitesHtml = renderSuiteResults(results, id);

  const content = headerHtml + failedFilterToggle() + suitesHtml + autoExpandFailedScript()
    + `<div style="margin-top:1rem"><a href="/" class="btn btn-outline btn-sm">&larr; Back to Dashboard</a></div>`;

  const isHtmx = c.req.header("HX-Request") === "true";
  if (isHtmx) return c.html(content);
  return c.html(layout(`Run #${id}`, content));
});

export default runs;
