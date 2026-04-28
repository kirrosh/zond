---
id: decision-3
title: Future of zond serve / web UI
date: '2026-04-28 14:05'
status: proposed
---

## Context

`zond serve` ships a Hono-based local dashboard (`src/web/`, ~2.6k LOC)
with health strip, endpoints/suites/runs tabs, and an explorer view. It
was built when the assumption was "humans review test runs in a browser"
— today the workflow is "AI agent runs `zond db diagnose` and reports
back via chat", which doesn't need a UI.

Empirical signal:
- Auto-loop iter-2..iter-4 never opened the dashboard.
- Sequential-dev session (5 ticks) never opened the dashboard.
- `zond db diagnose --json` covers every diagnostic surface a human
  would otherwise click into.
- The `serve` command carries its own port-conflict handling (TASK-18),
  watch-mode hot reload, and Hono routing — non-trivial maintenance.

decision-2 (drop MCP) established the principle: agent + CLI is the
canonical surface. A web UI is a third surface that only humans use.

## Decision

Three options on the table. **Not yet decided** — needs a maintainer
call.

**Option A — keep as-is.** Web UI is useful for occasional human
inspection (release demos, debugging hard-to-reproduce failures).
Cost: ~2.6k LOC ongoing maintenance, port-conflict edge cases, view
templates drifting behind core changes.

**Option B — replace with static `zond report` HTML output.** Drop
`zond serve` (server, hot reload, routes), replace with a single
`zond report <run-id> --output report.html` that emits a self-contained
static page. Removes web framework, removes port handling, keeps the
visual artefact for humans who want one. Estimated reduction: 2.6k → 400
LOC. Loses live "explorer" mode but agents don't use it anyway.

**Option C — drop entirely.** `zond db diagnose --json` plus a future
`--report-out html` (similar shape to TASK-LOW.1) covers all use cases.
Remove `src/web/` completely. Estimated reduction: 2.6k → 0 LOC.

## Recommendation pending

If the maintainer's answer is "I never personally open the dashboard" →
go with C. If "I demo it occasionally" → B. If "users have asked for
it" → A but document the cost.

## Consequences

- A: status quo, no churn.
- B: one breaking change (`zond serve` removed), one new command
  (`zond report`). Tests for current routes (`tests/web/`) need rewrite
  as snapshot tests of static HTML. ~2 days of work.
- C: one breaking change (`zond serve` removed). `tests/web/` deleted.
  Easiest, ~1 day of work. Reversible — git history retains the UI if
  ever wanted back.
