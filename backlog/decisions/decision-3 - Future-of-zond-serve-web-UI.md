---
id: decision-3
title: Future of zond serve / web UI
date: '2026-04-28 14:05'
status: accepted
---

## Context

`zond serve` ships a Hono-based local dashboard (`src/web/`, ~2.6k LOC)
with health strip, endpoints/suites/runs tabs, and an explorer view.

Empirical signal during recent agent sessions:
- Auto-loop iter-2..iter-4 never opened the dashboard.
- Sequential-dev session (5 ticks) never opened the dashboard.
- `zond db diagnose --json` covers every diagnostic surface a human
  would otherwise click into.

decision-2 (drop MCP) established the principle: agent + CLI is the
canonical surface. The web UI is a third surface that only humans use.

## Decision

**Keep `zond serve` as-is for now.** Maintainer call (2026-04-28).

Rationale: it's still useful for occasional human inspection (release
demos, debugging hard-to-reproduce failures, eyeballing run history),
and there's no immediate cost of carrying it. The "agent + CLI" focus
established by decision-2 is about the *primary* integration surface;
a secondary human-facing UI doesn't conflict with it.

This decision is **revisitable** when:
- The web UI breaks against a core change (drift cost surfaces).
- A new feature requires a parallel implementation in src/web/ AND
  src/cli/ — at that point evaluate whether to drop the UI half.
- Maintenance time spent on `tests/web/` exceeds 1 dev-day in any
  given quarter.

## Consequences

- No code change. `src/web/` stays.
- TASK-MEDIUM.7 (dead-code scan via knip) **excludes `src/web/`** from
  pruning targets — anything reachable through `zond serve` counts as
  used.
- TASK-16 (Cmd+K palette / fuzzy search), previously archived
  pending this decision, can be unarchived if the user actually wants
  it. For now it stays archived.
- Future test work on `tests/web/` is fair game; don't actively grow
  the surface without checking if a CLI flag would do.
