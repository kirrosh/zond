---
id: decision-4
title: Future of zond export postman
date: '2026-04-28 14:05'
status: implemented (reversed 2026-05-09 — TASK-286)
---

## 2026-05-09 update — REVERSED, command removed (TASK-286)

m-13 audit-and-consolidation §3 reversed this decision: the postman
exporter (`src/cli/commands/export.ts` + `src/core/exporter/postman.ts`,
~963 LOC) is removed in m-13. OpenAPI-driven Postman tooling already
covers the round-trip use case; maintaining a parallel YAML→Postman
path is not justified by observed usage. The original "keep as-is"
rationale below is preserved for history.

---


## Context

`zond export postman` (single file, `src/core/exporter/postman.ts`,
~963 LOC) converts YAML test suites to Postman Collection v2.1 JSON.
Includes assertion mapping (status/body/headers/duration → `pm.test`),
captures → `pm.environment.set`, `set:`/`skip_if`/`for_each` → Postman
pre-request scripts.

Audience: QA teams that live in Postman and want to pick up zond's
generated suites without learning the YAML format.

## Decision

**Keep `zond export postman` as-is.** Maintainer call (2026-04-28).

Rationale: even without measured demand, the surface is useful as a
QA-onboarding bridge — someone migrating from a Postman-first workflow
into zond benefits from being able to round-trip. Removing it now would
foreclose that path with no immediate gain.

This decision is **revisitable** when:
- A new probe class lands and the maintenance cost of teaching the
  exporter about it is non-trivial (>0.5 dev-day). At that point
  evaluate "narrow the surface" — document only the assertion subset
  the exporter handles, don't promise round-trip for new shapes.
- Telemetry (or user feedback) shows zero usage across N releases.

## Consequences

- No code change. `src/core/exporter/postman.ts` stays.
- TASK-MEDIUM.7 (dead-code scan) **excludes the exporter** from pruning
  targets.
- New probe types (TASK-50 idempotency, TASK-51 consistency report,
  etc.) are NOT required to add Postman-export coverage at landing
  time; they can ship export support as a follow-up or skip it entirely
  (file an issue noting the gap rather than blocking the feature).
- Documentation in `ZOND.md` should add a single line clarifying scope:
  "Best-effort export of the basic CRUD/smoke shape; novel probe
  classes may not round-trip." — small ergonomic win for users.
