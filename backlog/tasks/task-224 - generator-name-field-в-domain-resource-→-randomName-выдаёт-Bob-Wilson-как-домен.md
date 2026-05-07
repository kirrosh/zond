---
id: TASK-224
title: >-
  generator: name field в domain-resource → randomName выдаёт 'Bob Wilson' как
  домен
status: To Do
assignee: []
created_date: '2026-05-07 14:56'
labels:
  - feedback-loop
  - api-resend
  - generator
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F16, class likely_bug. Repro: crud-domains.yaml name: {{randomName}} -> sent name:'Bob Wilson' -> API 'The domain bob wilson is invalid'. Expected: для resource типа domain поле name требует домен-подобное значение (test-{{randomString}}.example.com); либо подсказка в generate output. Actual: общий heuristic name->randomName. Log: /tmp/zond-fb/resend/rounds/raw-04.log; domains-run.json
<!-- SECTION:DESCRIPTION:END -->
