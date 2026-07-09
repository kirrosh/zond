---
id: ARV-370
title: >-
  checks: add error_response_disclosure check for stack-trace leaks in error
  bodies
status: To Do
assignee: []
created_date: '2026-07-08 10:46'
labels:
  - checks
  - security
dependencies: []
references:
  - reports/docgen-api-v30/20260708-131254/report-zond.md#MF2
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ни один из активных checks сейчас не флагает information disclosure через stack-trace-контент в телах error-ответов (внутренние file paths, class/namespace names, .NET `:line N`, middleware pipeline). Найдено вручную при скане docgen-api-v30: 6+ эндпоинтов текут полными .NET stack trace через поле errorDetail на обычных 404/400.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Детерминированный regex-check над телом response: флагать, когда error-status ответ содержит stack-trace-подобные строки (' at <Namespace>.<Class>.<Method>', абсолютные file paths, ':line N', частые exception-class паттерны). Severity: medium, evidence = буквально совпавшая подстрока — без суждения (matches или нет).
<!-- SECTION:PLAN:END -->
