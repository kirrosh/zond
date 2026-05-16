---
id: TASK-226
title: clean --api удаляет spec.json (входной снапшот)
status: Done
assignee: []
created_date: '2026-05-08 07:55'
updated_date: '2026-05-08 08:03'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F1, class definitely_bug
Repro: cd workdir && zond clean --api sentry (dry-run) — spec.json попадает в список к удалению
Expected: clean удаляет производные артефакты (catalog/fixtures/resources/probes), но НЕ spec.json; для удаления spec нужен отдельный флаг --include-spec
Actual: manifest.json содержит запись {path: 'apis/sentry/spec.json', category: 'spec'}, и clean без --all перечисляет его среди файлов to delete
Log: /tmp/zond-fb/sentry/rounds/raw-04.log (clean dry-run секция)
<!-- SECTION:DESCRIPTION:END -->
