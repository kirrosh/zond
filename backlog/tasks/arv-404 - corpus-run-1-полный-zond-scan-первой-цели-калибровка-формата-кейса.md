---
id: ARV-404
title: 'corpus run #1: полный /zond-scan первой цели + калибровка формата кейса'
status: Done
assignee: []
created_date: '2026-07-10 07:28'
updated_date: '2026-07-10 08:27'
labels:
  - m-28
dependencies:
  - ARV-403
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Первый прогон серии: полный depth-pass по конвенции /zond-scan (live на sandbox по умолчанию, --safe fallback). Выход: report-api.md + report-zond.md + задачи по findings (литмус) + черновик case study. На этом прогоне калибруем формат кейса для Bucket B.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Прогон выполнен, report-api.md и report-zond.md сохранены
- [x] #2 Findings report-zond разобраны в backlog-задачи по литмусу
- [x] #3 Черновик case study по итогам прогона
<!-- AC:END -->
