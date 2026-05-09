---
id: TASK-250
title: >-
  coverage --json: envelope не содержит run_id (console печатает "— Run #N",
  JSON нет)
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
updated_date: '2026-05-09 09:06'
labels:
  - feedback-loop
  - api-sentry
  - coverage
  - ux
milestone: m-14
dependencies:
  - TASK-242
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-10 new finding F2, class ux-papercut.
Follow-up на TASK-242 (run-driven coverage).

Repro:
```
zond coverage --api sentry --json | jq '.data | keys'
# → ["covered","coveredEndpoints","percentage","total","uncovered","uncoveredEndpoints"]
zond coverage --api sentry | head -1
# → "Coverage: 94/219 endpoints (43%) — Run #41"
```

Expected: JSON envelope содержит `run_id` (или `runId`) рядом с `covered`/`total` — иначе CI-парсер не знает, по какому run-у считалось. Console показывает Run-id, JSON — нет. Несимметрия.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 `zond coverage --json` envelope содержит `runId` (numeric, рядом с `covered`/`total`/`percentage`).
- [ ] #2 При `--run-id N` поле отражает указанный run; при default — last run.
- [ ] #3 Regression-test: `jq '.data.runId' < json` → number, не null.
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->
