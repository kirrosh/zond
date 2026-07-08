---
id: ARV-268
title: >-
  http-client: replace global setHttpAuditRecorder with per-call option (ARV-265
  design-smell)
status: To Do
assignee: []
created_date: '2026-05-17 11:45'
updated_date: '2026-05-18 13:02'
labels:
  - http-client
  - refactor
  - defer-post-m-23
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

ARV-265 added module-level mutable state to `src/core/runner/http-client.ts`:

```ts
let _auditRecorder: ((rec: AuditRecord) => void) | null = null;
export function setHttpAuditRecorder(recorder) { _auditRecorder = recorder; }
```

Used by `probe security` / `probe mass-assignment` / `prepare-fixtures --cascade` to capture HTTP touches without surgery on those commands' internals (they call `executeRequest` from many sites).

## Problem

Global mutable state. Safe today because zond is single-process / single-command, but:

- If a future zond command runs two probes concurrently in the same process they'd clobber each other's recorder.
- Tests that mock-patch `executeRequest` could leak the recorder across test cases (the `finally` in `withHttpAudit` mitigates but only if every caller uses that helper).
- It's a foot-gun for future contributors who don't notice the module-level state.

## Goal

Thread the recorder through `executeRequest` as a regular call option, not via module state.

## Approach

- Add `audit?: (rec: AuditRecord) => void` to `FetchOptions`.
- `withHttpAudit(fn)` becomes a thin context helper that callers invoke with an explicit recorder — they pass it down to whatever they call.
- Trickier path: probe internals (security-probe.ts, mass-assignment-probe.ts) call `executeRequest` from many places. Either thread options through every call (~8 sites), or wrap `executeRequest` once at the probe-command boundary into a closure that pre-binds the recorder.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No module-level mutable state in http-client.ts
- [ ] #2 All four ARV-265 producers still persist correctly
- [ ] #3 Smoke test: two concurrent `probe security` invocations in one process don't clobber each other
- [ ] #4 withHttpAudit() helper retained for ergonomics (it's a nice API)

## Out of scope

- Refactoring probe internals to take an HTTP-context object (separate cleanup)
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
