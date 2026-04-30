// Single-file inline CSS for the run report.
// Self-contained: no @import, no external fonts. System UI stack only.
// Light + dark via prefers-color-scheme. Print-friendly for PDF export.

export const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fbfbfd;
  --bg-elev: #ffffff;
  --bg-muted: #f3f4f6;
  --bg-code: #f6f8fa;
  --fg: #0b0d12;
  --fg-muted: #5b6472;
  --border: #e5e7eb;
  --border-strong: #d1d5db;
  --accent: #3b82f6;
  --accent-fg: #ffffff;
  --pass: #10b981;
  --pass-bg: #d1fae5;
  --fail: #ef4444;
  --fail-bg: #fee2e2;
  --warn: #f59e0b;
  --warn-bg: #fef3c7;
  --info: #6366f1;
  --info-bg: #e0e7ff;
  --shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0d12;
    --bg-elev: #11141b;
    --bg-muted: #181c25;
    --bg-code: #0f1219;
    --fg: #e5e7eb;
    --fg-muted: #9aa3b2;
    --border: #1f242f;
    --border-strong: #2c3340;
    --accent: #60a5fa;
    --accent-fg: #0b0d12;
    --pass: #34d399;
    --pass-bg: #052e22;
    --fail: #f87171;
    --fail-bg: #2a0e10;
    --warn: #fbbf24;
    --warn-bg: #2a1d05;
    --info: #818cf8;
    --info-bg: #1c1c3a;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 6px 24px rgba(0,0,0,.4);
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  font-size: 14px;
  line-height: 1.5;
  background: var(--bg);
  color: var(--fg);
  -webkit-font-smoothing: antialiased;
}
.container { max-width: 1080px; margin: 0 auto; padding: 32px 24px 64px; }
.mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace; }

/* ── Hero ── */
.hero {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px 32px;
  margin-bottom: 24px;
  box-shadow: var(--shadow);
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: center;
}
.hero h1 {
  margin: 0 0 6px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.hero .sub {
  font-size: 13px;
  color: var(--fg-muted);
}
.hero .meta {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px 18px;
}
.hero .meta dt { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--fg-muted); margin: 0; }
.hero .meta dd { font-size: 13px; margin: 2px 0 0; word-break: break-all; }
.hero .meta dd.mono { font-size: 12px; }

/* Pass-rate ring */
.ring { position: relative; width: 140px; height: 140px; }
.ring svg { transform: rotate(-90deg); width: 100%; height: 100%; }
.ring .track { stroke: var(--border); }
.ring .fill { transition: stroke-dashoffset .6s ease; }
.ring .label {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center;
}
.ring .label .pct { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
.ring .label .lbl { font-size: 11px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: .08em; }

/* ── Status badges ── */
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  background: var(--bg-muted); color: var(--fg-muted);
  border: 1px solid var(--border);
  white-space: nowrap;
}
.badge.pass { background: var(--pass-bg); color: var(--pass); border-color: transparent; }
.badge.fail { background: var(--fail-bg); color: var(--fail); border-color: transparent; }
.badge.warn { background: var(--warn-bg); color: var(--warn); border-color: transparent; }
.badge.info { background: var(--info-bg); color: var(--info); border-color: transparent; }
.badge.solid-pass { background: var(--pass); color: white; border-color: transparent; }
.badge.solid-fail { background: var(--fail); color: white; border-color: transparent; }
.badge.dot::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

/* ── KPI strip ── */
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.kpi {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.kpi .n { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
.kpi .l { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--fg-muted); margin-top: 2px; }
.kpi.pass .n { color: var(--pass); }
.kpi.fail .n { color: var(--fail); }
.kpi.warn .n { color: var(--warn); }

/* ── Section ── */
section { margin-top: 32px; }
section h2 { font-size: 16px; font-weight: 600; margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
section h2 .count { font-size: 12px; color: var(--fg-muted); font-weight: 500; }

/* ── Filter bar ── */
.filters {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-bottom: 14px;
}
.filters button {
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--fg-muted);
  cursor: pointer;
  transition: all .15s;
}
.filters button:hover { color: var(--fg); border-color: var(--border-strong); }
.filters button.active { background: var(--fg); color: var(--bg); border-color: var(--fg); }

/* ── Failure card ── */
.cards { display: flex; flex-direction: column; gap: 8px; }
.card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color .15s;
}
.card:hover { border-color: var(--border-strong); }
.card.hidden { display: none; }
.card > .head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  background: transparent;
  border: 0;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
}
.card > .head:hover { background: var(--bg-muted); }
.card .chev {
  width: 14px; height: 14px;
  transition: transform .2s;
  flex-shrink: 0;
  color: var(--fg-muted);
}
.card.open .chev { transform: rotate(90deg); }
.card .method {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-muted);
  color: var(--fg-muted);
  flex-shrink: 0;
  min-width: 50px;
  text-align: center;
}
.card .method.GET { color: #10b981; }
.card .method.POST { color: #3b82f6; }
.card .method.PUT { color: #f59e0b; }
.card .method.PATCH { color: #f59e0b; }
.card .method.DELETE { color: #ef4444; }
.card .name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card .badges { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }
.card .body {
  display: none;
  border-top: 1px solid var(--border);
  background: var(--bg-muted);
}
.card.open .body { display: block; }

.card .actions {
  display: flex; gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.btn {
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elev);
  color: var(--fg);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all .15s;
}
.btn:hover { border-color: var(--border-strong); background: var(--bg); }
.btn.copied { background: var(--pass-bg); color: var(--pass); border-color: transparent; }

/* Tabs */
.tabs { display: flex; border-bottom: 1px solid var(--border); padding: 0 14px; }
.tabs button {
  font: inherit;
  font-size: 12px;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 10px 12px;
  margin-bottom: -1px;
  cursor: pointer;
  color: var(--fg-muted);
  transition: all .15s;
}
.tabs button:hover { color: var(--fg); }
.tabs button.active { color: var(--fg); border-bottom-color: var(--fg); font-weight: 600; }
.panel { padding: 14px; display: none; }
.panel.active { display: block; }

.kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px 14px; font-size: 12px; }
.kv dt { color: var(--fg-muted); }
.kv dd { margin: 0; word-break: break-all; }

pre.code {
  margin: 6px 0 0;
  padding: 12px 14px;
  background: var(--bg-code);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  line-height: 1.55;
  overflow-x: auto;
  max-height: 360px;
  overflow-y: auto;
  white-space: pre;
}
.code-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--fg-muted);
  margin-top: 12px;
}
.code-label:first-child { margin-top: 0; }

/* JSON syntax highlighting (regex-driven) */
.j-key { color: #b45309; }
.j-str { color: #047857; }
.j-num { color: #1d4ed8; }
.j-bool { color: #7c3aed; }
.j-null { color: #6b7280; }
@media (prefers-color-scheme: dark) {
  .j-key { color: #fbbf24; }
  .j-str { color: #34d399; }
  .j-num { color: #60a5fa; }
  .j-bool { color: #c084fc; }
  .j-null { color: #9aa3b2; }
}

/* Assertion list */
.asserts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.asserts li {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--bg-elev);
  font-size: 12px;
}
.asserts li.failed { border-color: var(--fail); background: var(--fail-bg); }
.asserts li.passed { border-color: var(--pass); background: var(--pass-bg); }
.asserts .a-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.asserts .a-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
.asserts .a-diff .lbl { color: var(--fg-muted); }

/* Coverage matrix */
.cov-grid {
  display: grid;
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.cov-row { display: grid; grid-template-columns: 1.5fr repeat(5, 60px); }
.cov-cell {
  background: var(--bg-elev);
  padding: 6px 8px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cov-cell.head { font-weight: 600; color: var(--fg-muted); text-transform: uppercase; font-size: 10px; }
.cov-cell.path { justify-content: flex-start; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cov-cell.s2 { background: var(--pass-bg); color: var(--pass); font-weight: 600; }
.cov-cell.s4 { background: var(--warn-bg); color: var(--warn); font-weight: 600; }
.cov-cell.s5 { background: var(--fail-bg); color: var(--fail); font-weight: 600; }
.cov-cell.serr { background: var(--fail); color: white; font-weight: 600; }
.cov-cell.empty { color: var(--border-strong); }

/* Footer */
footer {
  margin-top: 48px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--fg-muted);
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
footer a { color: var(--accent); text-decoration: none; }
footer a:hover { text-decoration: underline; }

/* Empty state */
.empty {
  background: var(--bg-elev);
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 32px 24px;
  text-align: center;
  color: var(--fg-muted);
  font-size: 13px;
}

/* Print */
@media print {
  .hero, .kpi, .card, .empty { box-shadow: none !important; }
  .card { break-inside: avoid; }
  .actions, .filters, .tabs button:not(.active) { display: none !important; }
  .panel { display: block !important; padding: 8px 14px; }
  body { background: white; color: black; }
}

@media (max-width: 720px) {
  .hero { grid-template-columns: 1fr; }
  .ring { width: 110px; height: 110px; justify-self: center; }
  .cov-row { grid-template-columns: 1.5fr repeat(5, 1fr); }
}
`;
