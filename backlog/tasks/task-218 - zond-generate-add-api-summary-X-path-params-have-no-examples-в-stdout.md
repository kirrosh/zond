---
id: TASK-218
title: 'zond generate/add api: summary ''X path params have no examples'' в stdout'
status: To Do
assignee: []
created_date: '2026-05-07 14:21'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F11, class ux-papercut
Repro: zond coverage выводит 50 warnings 'required_params_no_examples'
Expected: zond generate (или zond add api) выводит краткую сводку 'X path params have no examples — fill .env.yaml to enable positive/smoke-positive suites'
Actual: warnings видны только в zond coverage, другие команды не предупреждают
Log: /tmp/zond-fb/resend/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->
