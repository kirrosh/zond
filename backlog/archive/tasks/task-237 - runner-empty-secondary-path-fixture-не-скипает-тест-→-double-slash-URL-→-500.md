---
id: TASK-237
title: 'runner: empty secondary path-fixture не скипает тест → double-slash URL → 500'
status: Done
assignee: []
created_date: '2026-05-08 08:36'
updated_date: '2026-05-08 08:40'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 06, finding F1, class definitely_bug
Repro: test 'List a Repository Commits' в smoke-organizations-positive.yaml — organization_id_or_slug заполнен, но repository='' → URL /api/0/organizations/slug/repos//commits/ (двойной слеш) → backend 500
Expected: skip когда ЛЮБАЯ path-fixture в URL пустая (не только первая)
Actual: runner подставляет пустую строку в path → невалидный URL без warning; тест fail-ится с 500 вместо skip
Log: /tmp/zond-fb/sentry/rounds/raw-06.log
<!-- SECTION:DESCRIPTION:END -->
