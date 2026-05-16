---
id: ARV-235
title: 'annotate dump --pagination: short-circuit dump для page-based APIs'
status: To Do
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-16 10:55'
labels:
  - feedback-loop
  - api-github
  - m-16
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F8, class missing-feature
Repro: zond api annotate dump --api github --pagination --only repos,gists,issues,events,users (5 resources → 14KB)
Expected: для resources с page/offset params dump возвращает короткий маркер: {kind: pagination, type: page, note: stateful check skips page-based pagination — annotation has no effect}
Actual: те же 2-3KB parameters[] schema, агенту читать spec-овый dump только чтобы понять что нечего аннотировать.
Log: ~/Projects/zond-test/.fb-loop/rounds/dump-pagination.json
<!-- SECTION:DESCRIPTION:END -->
