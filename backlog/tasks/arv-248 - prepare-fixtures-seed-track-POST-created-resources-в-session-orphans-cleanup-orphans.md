---
id: ARV-248
title: >-
  prepare-fixtures --seed: track POST-created resources в session-orphans /
  cleanup --orphans
status: To Do
assignee: []
created_date: '2026-05-15 05:42'
updated_date: '2026-05-18 13:02'
labels:
  - feedback-loop
  - api-github
  - m-16
  - feature-m-22
  - defer-post-m-23
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F19, class quirk
Repro: prepare-fixtures --seed сделал POST /repos/.../hooks → получил id=623449666. После session end hook остался в репо (1 leak).
Expected: либо session-orphans tracking подхватывает seed-created resources, либо cleanup --orphans их убирает после run.
Actual: ресурс leak.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-04.log
<!-- SECTION:DESCRIPTION:END -->
