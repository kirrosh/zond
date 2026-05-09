---
id: TASK-218
title: 'zond generate/add api: summary ''X path params have no examples'' в stdout'
status: Done
assignee: []
created_date: '2026-05-07 14:21'
updated_date: '2026-05-09 09:36'
labels:
  - feedback-loop
  - api-resend
milestone: m-14
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F11, class ux-papercut
Repro: zond coverage выводит 50 warnings 'required_params_no_examples'
Expected: zond generate (или zond add api) выводит краткую сводку 'X path params have no examples — fill .env.yaml to enable positive/smoke-positive suites'
Actual: warnings видны только в zond coverage, другие команды не предупреждают
Log: /tmp/zond-fb/resend/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->
