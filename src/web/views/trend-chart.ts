import type { PassRateTrendPoint } from "../../db/queries.ts";

export function renderTrendChart(points: PassRateTrendPoint[]): string {
  const chronological = [...points].reverse();
  if (chronological.length < 2) {
    return `<div class="trend-chart" style="text-align:center;color:var(--text-dim);padding:1rem;">Not enough data for trend chart</div>`;
  }

  const w = 700, h = 200;
  const pad = { top: 20, right: 20, bottom: 30, left: 45 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const n = chronological.length;

  const coords = chronological.map((p, i) => ({
    x: pad.left + (i / (n - 1)) * plotW,
    y: pad.top + plotH - (p.pass_rate / 100) * plotH,
    ...p,
  }));

  // Grid lines at 0, 25, 50, 75, 100%
  const gridLines = [0, 25, 50, 75, 100].map((pct) => {
    const y = pad.top + plotH - (pct / 100) * plotH;
    return `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="var(--border)" stroke-dasharray="4 3"/>
      <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-dim)" font-size="11">${pct}%</text>`;
  }).join("\n");

  // Area fill
  const areaPath = `M${coords[0]!.x},${pad.top + plotH} L${coords.map((c) => `${c.x},${c.y}`).join(" L")} L${coords[n - 1]!.x},${pad.top + plotH} Z`;

  // Polyline
  const polyPoints = coords.map((c) => `${c.x},${c.y}`).join(" ");

  // Dots with tooltips
  const dots = coords.map((c) => {
    const date = c.started_at.split("T")[0];
    return `<circle cx="${c.x}" cy="${c.y}" r="4" fill="var(--pass)" stroke="var(--bg)" stroke-width="2">
      <title>Run #${c.run_id}: ${c.pass_rate}% (${date})</title>
    </circle>`;
  }).join("\n");

  // X-axis date labels: first, middle, last
  const indices = [0, Math.floor((n - 1) / 2), n - 1];
  const xLabels = indices.map((i) => {
    const c = coords[i]!;
    const date = c.started_at.split("T")[0];
    return `<text x="${c.x}" y="${h - 5}" text-anchor="middle" fill="var(--text-dim)" font-size="11">${date}</text>`;
  }).join("\n");

  return `
    <div class="trend-chart">
      <div class="section-title">Pass Rate Trend</div>
      <svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet">
        ${gridLines}
        <path d="${areaPath}" fill="var(--pass)" fill-opacity="0.15"/>
        <polyline points="${polyPoints}" fill="none" stroke="var(--pass)" stroke-width="2"/>
        ${dots}
        ${xLabels}
      </svg>
    </div>`;
}
