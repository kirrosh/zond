---
id: TASK-240
title: >-
  generate: несогласованные имена suite-файлов (smoke-tag.yaml vs
  smoke-tag-negative.yaml)
status: To Do
assignee: []
created_date: '2026-05-08 08:37'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 06, finding F4, class quirk
Repro: ls apis/sentry/tests/ | grep -E '^smoke-(seer|users|explore)'
Expected: единая convention — всегда smoke-<tag>-{negative|positive|unsafe}.yaml
Actual: Seer → smoke-seer.yaml + smoke-seer-negative.yaml (дублируют name: seer-smoke); Users → smoke-users.yaml без суффиксов; Explore → smoke-explore-negative.yaml без основного
Log: ls apis/sentry/tests/
<!-- SECTION:DESCRIPTION:END -->
