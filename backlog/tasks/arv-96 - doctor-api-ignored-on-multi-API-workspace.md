---
id: ARV-96
title: doctor --api ignored on multi-API workspace
status: Done
assignee: []
created_date: '2026-05-11 08:14'
updated_date: '2026-05-11 08:19'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F1, class definitely_bug
API: sentry

Repro:
  zond doctor --api sentry
  zond doctor --api=sentry --json
  zond --api sentry doctor

Expected: --api <name> resolves the active API (as in every other CLI command); или .zond/current-api=sentry должно резолвиться по умолчанию.

Actual: 'Error: Multiple APIs registered (resend, sentry). Pass --api <name>.' — флаг полностью проигнорирован. Бьёт ТОЛЬКО doctor (check spec, prepare-fixtures, checks run, probe security — все работают с тем же флагом).

Effect: блокирует канонический pre-flight 'Phase 1 — Orient' из zond/SKILL.md L201; блокирует security-rule из zond-base/SKILL.md L88-89 (вместо cat .secrets.yaml зови doctor --json).

Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log
Related: skill-drift SD2
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 doctor --api <name> resolves the API on multi-API workspace
- [x] #2 All three forms work: 'doctor --api sentry', 'doctor --api=sentry', '--api sentry doctor'
- [x] #3 Test added covering multi-API resolution via --api flag
<!-- AC:END -->
