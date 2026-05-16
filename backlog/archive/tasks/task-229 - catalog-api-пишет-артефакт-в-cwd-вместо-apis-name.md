---
id: TASK-229
title: catalog --api пишет артефакт в cwd вместо apis/<name>/
status: Done
assignee: []
created_date: '2026-05-08 07:56'
updated_date: '2026-05-08 08:03'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F1, class definitely_bug
Repro: cd workdir && rm -f .api-catalog.yaml && zond catalog --api sentry && ls -la .api-catalog.yaml apis/sentry/.api-catalog.yaml
Expected: файл создаётся/перезаписывается по пути из manifest: apis/sentry/.api-catalog.yaml
Actual: файл создаётся в cwd (./.api-catalog.yaml, 152 KB); прежний apis/sentry/.api-catalog.yaml остаётся со старым содержимым; возникают два расходящихся файла
Log: /tmp/zond-fb/sentry/rounds/raw-02.log (=== catalog === секция + ls -la)
<!-- SECTION:DESCRIPTION:END -->
