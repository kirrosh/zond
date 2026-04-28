---
id: decision-4
title: Future of zond export postman
date: '2026-04-28 14:05'
status: proposed
---

## Context

`zond export postman` (single file, `src/core/exporter/postman.ts`,
~963 LOC) converts YAML test suites to Postman Collection v2.1 JSON.
Includes assertion mapping (status/body/headers/duration → `pm.test`),
captures → `pm.environment.set`, `set:`/`skip_if`/`for_each` → Postman
pre-request scripts.

Audience question: who runs zond YAML in Postman?

- AI agents don't — they call `zond run` directly.
- Humans running zond as a CLI don't — they don't open Postman.
- The intended audience was "QA team that lives in Postman; let them
  pick up our generated suites". This was hypothetical at design time
  and never validated by an actual user request.

The exporter is non-trivial:
- Translates assertions across two semantic models (zond → chai/pm).
- Handles edge cases (`type: integer` → `Number.isInteger()` not
  `.be.a('number')`, captures-as-pre-request, etc.).
- 963 LOC of mapping code that has to keep up with every new
  zond YAML feature.

## Decision

Three options. **Not yet decided.**

**Option A — keep.** Some user has asked for it / will ask for it. Cost:
ongoing maintenance, especially when new probe types or assertion
shapes land (TASK-50 idempotency probe, TASK-51 consistency report,
etc. — each new shape needs an exporter mapping).

**Option B — narrow the surface.** Keep export but document only the
"basic suite" subset that's actually used; don't promise round-trip
fidelity for all new features. Saves ongoing translation burden.

**Option C — drop.** Move `src/core/exporter/postman.ts` to a separate
optional package (`@kirrosh/zond-postman-exporter`) or just delete it.
Anyone who actually wanted Postman output writes a small adapter
themselves; zond's job is testing, not Postman migration.

## Recommendation pending

If usage telemetry says zero in the last N releases → C. If a single
loud user → A. Most likely outcome: B (deprecate but don't remove
mid-cycle).

## Consequences

- A: status quo, but every new probe/assertion type costs +N LOC of
  exporter mapping.
- B: documentation-only change now, removal in a future major.
- C: 963 LOC removed, one breaking change (`zond export postman`
  removed), one CHANGELOG entry. Reversible via git history.
