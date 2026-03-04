/**
 * Health strip: coverage donut, run stats, env alert banner.
 */

import type { CollectionState } from "../data/collection-state.ts";
import { formatDuration } from "../../core/reporter/console.ts";

export function renderHealthStrip(state: CollectionState): string {
  const { coveragePct, coveredCount, totalEndpoints, runPassed, runFailed, runSkipped, runTotal, runDurationMs, envAlert, latestRun } = state;

  const donut = renderCoverageDonut(coveragePct, coveredCount, totalEndpoints);

  const hasRun = latestRun !== null;
  const duration = runDurationMs != null ? formatDuration(runDurationMs) : "-";

  const statsHtml = hasRun
    ? `<div class="health-stats">
        <div class="stat-block stat-pass"><span class="stat-value">${runPassed}</span><span class="stat-label">passed</span></div>
        <div class="stat-block stat-fail"><span class="stat-value">${runFailed}</span><span class="stat-label">failed</span></div>
        <div class="stat-block stat-skip"><span class="stat-value">${runSkipped}</span><span class="stat-label">skipped</span></div>
        <div class="stat-block"><span class="stat-value">${duration}</span><span class="stat-label">duration</span></div>
      </div>`
    : `<div class="health-stats">
        <div class="stat-block"><span class="stat-value">-</span><span class="stat-label">No runs yet</span></div>
      </div>`;

  // Mini progress bar
  const progressHtml = hasRun && runTotal > 0
    ? `<div class="health-progress">
        <div class="progress-bar" style="height:6px;">
          <div class="progress-pass" style="width:${(runPassed / runTotal * 100).toFixed(1)}%"></div>
          <div class="progress-fail" style="width:${(runFailed / runTotal * 100).toFixed(1)}%"></div>
          <div class="progress-skip" style="width:${(runSkipped / runTotal * 100).toFixed(1)}%"></div>
        </div>
        <span class="health-progress-label">${runPassed}/${runTotal} steps passed</span>
      </div>`
    : "";

  const envAlertHtml = envAlert ? renderEnvAlert(envAlert) : "";

  return `
    <div class="health-strip">
      <div class="health-donut-zone">
        ${donut}
        <div class="coverage-label">
          <span class="label-title">Coverage</span>
          <span class="label-value">${coveredCount} / ${totalEndpoints} endpoints</span>
        </div>
      </div>
      <div class="health-info-zone">
        ${statsHtml}
        ${progressHtml}
      </div>
      ${envAlertHtml}
    </div>`;
}

export function renderCoverageDonut(pct: number, covered: number, total: number): string {
  // SVG donut chart
  const size = 80;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  const color = pct >= 80 ? "var(--pass)" : pct >= 50 ? "var(--warn, #fbbf24)" : "var(--fail)";
  const trackColor = "var(--border)";

  return `
    <div class="coverage-donut">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="${trackColor}" stroke-width="${stroke}" />
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="${color}" stroke-width="${stroke}"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
          stroke-linecap="round"
          transform="rotate(-90 ${size / 2} ${size / 2})" />
        <text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="central"
          fill="var(--text)" font-size="16" font-weight="700" font-family="inherit">${pct}%</text>
      </svg>
      <div class="donut-label">${covered}/${total} endpoints</div>
    </div>`;
}

export function renderEnvAlert(message: string): string {
  return `
    <div class="env-alert">
      <span class="env-alert-icon">&#9888;</span>
      <span>${message}</span>
    </div>`;
}
