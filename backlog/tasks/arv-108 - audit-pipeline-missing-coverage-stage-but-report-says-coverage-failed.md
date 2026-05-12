---
id: ARV-108
title: audit pipeline missing coverage stage but report says coverage failed
status: Done
assignee: []
created_date: '2026-05-11 08:51'
updated_date: '2026-05-11 09:05'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F15, class likely_bug
API: sentry

Repro:
  zond audit --api sentry --dry-run
  # → Plan: zond audit --api sentry (7 stages)
  #   1. prepare-fixtures …
  #   2. generate …
  #   3. probe static …
  #   4. session start …
  #   5. run tests …
  #   6. run probes …
  #   7. session end …
  # (no coverage stage)
  zond audit --api sentry --out audit.html
  grep -E 'Coverage' audit.html
  # → 'Coverage data unavailable — coverage stage failed or returned non-JSON.'

Expected: either plan has 8th stage 'coverage', or audit-report.html doesn't say 'coverage stage failed' when stage isn't in pipeline (says 'coverage not configured / pass --coverage' or hides section).

Actual: skill (zond/SKILL.md L805) promises pipeline 'prepare-fixtures → generate → probe static → session-wrapped run on tests + probes → coverage → audit-report.html'. Reality: coverage absent; HTML report says 'failed'. Internal inconsistency.

Effect: Phase 6 (coverage) usually needed for CI gate; user runs zond audit, expects % coverage in one file, gets 'unavailable' without explanation.

Log: rounds/raw-03.log block '=== zond audit --dry-run ===' + audit-03.html grep
Related: skill-drift SD7
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Round 03: coverage now appears in dry-run plan; HTML warning differentiates 'no session runs' / 'parse error' / 'exit N'. Coverage stays non-fatal for the audit exit code.
<!-- SECTION:NOTES:END -->
