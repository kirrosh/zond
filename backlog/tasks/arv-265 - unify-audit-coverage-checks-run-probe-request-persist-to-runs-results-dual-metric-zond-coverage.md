---
id: ARV-265
title: >-
  unify audit-coverage: checks run + probe + request persist to runs/results,
  dual-metric zond coverage
status: Done
assignee: []
created_date: '2026-05-17 11:05'
updated_date: '2026-05-17 11:36'
labels:
  - coverage
  - db
  - checks
  - probe
  - reporting
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`zond coverage` only counts `zond run` results because only `zond run` calls `createRun() + saveResults()`. The other three HTTP-producing commands (`zond checks run`, `zond probe`, `zond request`) emit ndjson/stdout but write nothing persistent, so all their HTTP touches are invisible to coverage.

On the live GitHub scan (zond-scan, 1184 endpoints, 2026-05-17): `zond checks run` executed 1500 case-runs across 619 GET endpoints, but `zond coverage --union session` returned `pass-coverage: 0%, hit-coverage: 0%`. The user-visible counter says "scan failed" when the scan actually reached 52% of the surface. This is UX2 in `report-zond.md` from that scan.

Schema already half-supports this — `runs.run_kind` column accepts `'regular'|'probe'|'check'` (see ARV-55, migration 0001_run_kind.sql) and the coverage query has `kindClause` filtering. The wiring on the producer side never landed.

## Goal

Single source of truth for "did zond touch endpoint X in this session". Dual-metric output from `zond coverage`:

- **test-coverage**: passing test suites from `zond run` (current semantics, unchanged)
- **audit-coverage**: any HTTP touch from any source in the session, with by-source breakdown

User running `/zond-scan` sees both metrics in the report; junior reader doesn't get fooled by `0%`.

## Scope — Backend (zond core)

### B1 — `zond checks run` persists to runs/results

- `src/cli/commands/checks.ts` (run subcommand): wrap the depth/stateful pass with `createRun({run_kind: 'check', collection_id, session_id, tags: [check-name, phase]})` at start, batched `saveResults()` per case event, `finalizeRun()` at end with aggregated counts.
- `case_result` ndjson events → `results` rows. Fields map: operation.method/path → request_method/request_url; response.status → response_status; finding.severity → status (`pass`|`fail`|`skip`); finding.evidence → response_body.
- `suite_name` synthesizes as `"checks/<phase>"`; `test_name` as `"<check-name>::<METHOD> <path>"`. These are pseudo-names but keep results queryable.
- Behind a feature flag for one release: `ZOND_CHECKS_PERSIST=1` default off → flip to default on after one minor.

### B2 — `zond probe` (live) persists to runs/results

- Same pattern. `run_kind: 'probe'`. Already half-supported via `--emit-tests` + `zond run`, but that's a two-step indirect path. Direct-write removes the indirection.
- Dry-run mode: still no persistence (no HTTP).

### B3 — `zond request` persists to runs/results when in session

- One ad-hoc request = one synthetic 1-test run with `run_kind: 'request'` (extends the enum).
- Schema change: extend CHECK constraint to include `'request'`. Migration 0011.
- Behavior only kicks in when `ZOND_SESSION` env / `.zond/current-session` is set; otherwise no-op (avoids polluting db with ad-hoc curl-replacement calls).

### B4 — `prepare-fixtures --cascade` (discovery list calls) persists

- Each cascade list-call → result row with `run_kind: 'request'` (or new `'fixture'` kind).
- Captures fixture-discovery HTTP volume in audit-coverage.

### B5 — Extend `runs.run_kind` enum

```sql
-- migration 0011_run_kind_request.sql
ALTER TABLE runs DROP CONSTRAINT ...;  -- SQLite: rebuild via temp table
-- New CHECK: run_kind IN ('regular','probe','check','request','fixture')
```

### B6 — `zond coverage` dual-metric output

CLI changes (`src/cli/commands/coverage.ts`):

- Default text output prints BOTH `test-coverage` and `audit-coverage` blocks (currently only one). audit-coverage shows union of all run_kinds in selected scope; test-coverage stays `run_kind='regular'` only.
- New flag `--scope test|audit|both` (default `both`). Legacy `--include-probe` / `--include-checks` keep working with deprecation note.
- Source breakdown table in audit mode:
  ```
  audit-coverage: 52% (619/1184)
    by source:
      checks      619 endpoints, 1500 events
      run           0 endpoints,    0 events
      probe         0 endpoints,    0 events (dry-run skipped)
      request       3 endpoints,    3 events
  ```
- JSON envelope: `data.test_coverage`, `data.audit_coverage.{by_source, reached, total}` (additive — keeps existing fields).

### B7 — Batched INSERT performance

- 1500-row INSERT per scan needs to be one transaction, not 1500 round-trips. Use existing `saveResults(runId, rows[])` which already batches.
- Worker-pool checks: events come from N concurrent workers — funnel through a single writer goroutine (or `Promise.all` then batch flush) to avoid SQLite contention.

### B8 — Session-less mode

- `zond checks run` without an active session: today works fine. After B1, persist anyway with `session_id = NULL`. `zond coverage --union session` won't see it (intentional — user didn't ask for grouping); but `zond coverage --since 1h` etc still works.
- `zond request` without session: skip persistence (B3 rule). Otherwise db fills with one-off ad-hoc calls.

## Scope — Skills / Docs

### S1 — `src/cli/commands/init/templates/skills/zond.md`

Coverage section currently says (paraphrase): "only `zond run` results are aggregated". Replace with explicit two-metric explanation:
- `test-coverage` = passing suites from `zond run`
- `audit-coverage` = any HTTP touch (checks/run/probe/request); includes by-source breakdown
- Add: "use audit-coverage to answer 'did this scan even reach the API?', use test-coverage to answer 'do our curated tests pass?'"

### S2 — `src/cli/commands/init/templates/skills/zond-checks.md`

Add note that `checks run` now contributes to audit-coverage after this task lands. Update example `zond coverage` outputs in skill template.

### S3 — `~/.claude/commands/zond-scan.md` (`/zond-scan` skill)

Currently the skill computes audit-reach manually via jq on ndjson. After this task lands, replace with `zond coverage --scope both --json` — one source of truth, simpler skill.

Specifically remove the "Audit-reach vs test-coverage" jq block (lines ~297-316 of `~/.claude/commands/zond-scan.md`) and replace with direct `zond coverage` call. The "HTTP status distribution" block stays — that's still ndjson-only data.

Also revert the redundant `generate --include 'method:GET'` + `run --validate-schema` in safe-mode flow that I added today: after this task, audit-coverage from `checks run` is enough; suites should be opt-in via `--with-suites`. The dupe HTTP cost on github (≈1500 extra requests, half the rate budget) wasn't worth the coverage signal that this task will give natively.

### S4 — `report-zond.md` UX2 mark resolved

In future scans, UX2 ("coverage 0% is misleading") references this task ID. Close the loop in the report template's example.

## Acceptance Criteria
<!-- AC:BEGIN -->
- AC #1: After `zond checks run --api X`, the run shows up in `zond coverage --scope audit` with status codes preserved.
- AC #2: `zond coverage --json` returns `{data: {test_coverage: {...}, audit_coverage: {by_source: {checks: N, run: M, probe: K, request: L}, reached, total}}}`.
- AC #3: Default `zond coverage` text output prints both metrics, with audit-coverage source breakdown.
- AC #4: Re-run github scan flow on zond-scans: `zond coverage` shows audit-coverage > 50% (619 GET endpoints / 1184 total) without running `zond generate` or `zond run`.
- AC #5: `zond probe ... --dry-run` does NOT pollute audit-coverage (no HTTP, no events). Live `zond probe` does.
- AC #6: `zond request GET /x` outside a session: no DB write. Inside session: 1 audit-coverage event.
- AC #7: Existing `zond coverage` consumers (tests, CI examples) not broken — legacy single-metric output mode available via `--scope test`.
- AC #8: SQLite CHECK constraint accepts `'request'` and `'fixture'` run_kinds; existing dbs migrate without data loss.
- AC #9: 1500-event scan completes in <2× the time of pre-fix scan (INSERT overhead acceptable).
- AC #10: Skill templates (`zond.md`, `zond-checks.md`, `/zond-scan`) updated and verified — re-running `/zond-scan` on github produces a report with both metrics natively.

## Out of scope (separate task ideas)

- `zond coverage --by-tag` (audit-coverage breakdown by OpenAPI tag, not just source). Useful for "which areas did the scan miss" — file as ARV-NNN follow-up.
- Renaming `pass-coverage`/`hit-coverage` to less ambiguous names. Naming churn, defer.
- Time-series coverage (deltas between sessions). Useful for "did this PR move the needle" — defer.

## Risks

- R1: `checks run` is hot path. Per-case INSERT could double scan time on big APIs. Mitigation: B7 (batched flush, one tx).
- R2: `runs` table grows fast — 1 scan = 1500 result rows. Long-term, need retention policy. Note for follow-up, not gating this task.
- R3: Existing dashboards/queries assume `run_kind = 'regular'`. Audit-mode is opt-in via flag — backwards compatible.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 After `zond checks run --api X` in a session, that activity appears in `zond coverage --scope audit` with status codes preserved.
- [ ] #2 `zond coverage --json` returns `{data: {test_coverage: {...}, audit_coverage: {by_source: {checks, run, probe, request}, reached, total}}}` envelope.
- [ ] #3 Default `zond coverage` text output prints both metrics with audit-coverage source breakdown.
- [ ] #4 Re-run of /zond-scan on github shows audit-coverage > 50% without zond generate or zond run.
- [ ] #5 `zond probe ... --dry-run` does NOT pollute audit-coverage. Live probe does.
- [ ] #6 `zond request` outside session: no DB write. Inside session: 1 event.
- [ ] #7 Legacy single-metric mode available via `--scope test`; existing CI/test consumers not broken.
- [ ] #8 Migration 0011 extends runs.run_kind CHECK to accept 'request' and 'fixture'; existing dbs migrate without data loss.
- [ ] #9 Performance: 1500-event scan completes in <2x pre-fix time (batched INSERT via saveResults).
- [ ] #10 Skill templates (zond.md, zond-checks.md, /zond-scan) updated; re-running /zond-scan on github produces both metrics natively.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: B1 checks run persists run_kind=check; B2 probe security/mass-assignment persist run_kind=probe; B3 zond request persists run_kind=request when in session; B4 prepare-fixtures --cascade persists run_kind=fixture; B5 migration 0002 widens CHECK enum via table rebuild; B6 coverage --scope test|audit|both with audit-coverage block + JSON data.audit_coverage.{reached,total,by_source,events,ratio}; S1-S3 skill templates + /zond-scan updated. Validated on github spec: audit-coverage 52% (619/1184) from checks run alone. 2287 tests pass.
<!-- SECTION:NOTES:END -->
