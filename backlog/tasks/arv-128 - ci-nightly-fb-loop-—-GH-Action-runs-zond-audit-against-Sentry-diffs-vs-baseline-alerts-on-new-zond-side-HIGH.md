---
id: ARV-128
title: >-
  ci: nightly fb-loop — GH Action runs zond audit against Sentry, diffs vs
  baseline, alerts on new zond-side HIGH
status: To Do
assignee: []
created_date: '2026-05-11 10:14'
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
- [ ] #1 .github/workflows/fb-loop-nightly.yml существует
- [ ] #2 .github/baselines/sentry-baseline.json существует (snapshot после m-18 раунда)
- [ ] #3 workflow_dispatch триггер работает локально (act / gh workflow run)
- [ ] #4 три ночи подряд прогона без алёртов после стабилизации
<!-- AC:END -->
