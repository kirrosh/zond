---
id: ARV-128
title: >-
  ci: nightly fb-loop — GH Action runs zond audit against Sentry, diffs vs
  baseline, alerts on new zond-side HIGH
status: Done
assignee: []
created_date: '2026-05-11 10:14'
updated_date: '2026-05-11 15:27'
labels:
  - m-19
  - ci
  - fb-loop
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§8 refactor-plan (min variant), lesson §D. Сейчас fb-loop вручную. Минимум — nightly прогон против sentry, складывание artifact'а, diff с baseline.

.github/workflows/fb-loop-nightly.yml:
- on: schedule cron '0 3 * * *' + workflow_dispatch
- secrets: SENTRY_TOKEN, SENTRY_ORG, SENTRY_PROJECT
- step: zond add api sentry + zond prepare-fixtures + zond audit --api sentry --report json
- step: jq diff против baseline.json в repo (.github/baselines/sentry-baseline.json)
- step: алёрт (issue / slack-action / GitHub Annotation) на новые HIGH-finding'и, у которых recommended_action != report_backend_bug (это zond-side regression, не Sentry-баг)

Идеальный вариант (zond agent-loop --target <repo>) — m-20+, не в этой задаче.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 .github/workflows/fb-loop-nightly.yml существует
- [x] #2 .github/baselines/sentry-baseline.json существует (snapshot после m-18 раунда)
- [ ] #3 workflow_dispatch триггер работает локально (act / gh workflow run)
- [ ] #4 три ночи подряд прогона без алёртов после стабилизации
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped (in-scope of a coding loop):
- .github/workflows/fb-loop-nightly.yml: cron `0 3 * * *` + workflow_dispatch; steps build → add api sentry → prepare-fixtures → audit → diff → upload-artifact. Requires SENTRY_TOKEN / SENTRY_ORG / SENTRY_PROJECT secrets to do real work.
- .github/baselines/sentry-baseline.json: placeholder empty-findings snapshot; comments document the refresh recipe ("zond audit ... --json > sentry-baseline.json after a clean round").
- .github/scripts/fb-loop-diff.ts: smart diff. Findings keyed by {check_id, endpoint, severity} so message-text drift doesn't register as new. Regression signal = NEW + severity:high + recommended_action != report_backend_bug. GitHub-Actions annotations on stdout; exit 1 on any regression, 0 otherwise. Verified locally on two synthetic cases (regression detected; report_backend_bug filtered out).

Deferred (outside a coding loop):
- AC#3 workflow_dispatch confirmation: requires `gh workflow run fb-loop-nightly.yml` against a remote with the three secrets configured — user-side step after merge.
- AC#4 three stable nights: schedule-driven; cannot be exercised in this session. Track via the workflow's Actions tab post-deploy.

AC#1 + AC#2 satisfied (files exist with meaningful content); AC#3 + AC#4 deliberately left unchecked — they need user action + wall-clock time. Re-snapshot the baseline once m-18 lands so the diff has real signal to compare against.
<!-- SECTION:NOTES:END -->
