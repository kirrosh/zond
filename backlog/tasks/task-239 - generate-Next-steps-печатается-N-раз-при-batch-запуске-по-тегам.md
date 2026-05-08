---
id: TASK-239
title: 'generate: Next steps печатается N раз при batch-запуске по тегам'
status: To Do
assignee: []
created_date: '2026-05-08 08:36'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 06, finding F3, class ux-papercut
Repro: for tag in Releases Events Alerts ...; do zond generate --api sentry --output apis/sentry/tests --tag "$tag"; done
Expected: Next steps один раз (или zond generate --tag T1,T2,T3 за один проход)
Actual: 18 одинаковых Next steps блоков — реальные warnings тонут
Log: /tmp/zond-fb/sentry/rounds/raw-06.log (секция генерации)
<!-- SECTION:DESCRIPTION:END -->
