---
id: TASK-75
title: 'T75: variable interpolation — нет warning''а на missing'
status: To Do
assignee: []
created_date: '2026-04-29 08:40'
labels:
  - bug
  - runner
milestone: m-3
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Если в YAML стоит `{{nonexistent_var}}`, zond шлёт литеральную строку `{{nonexistent_var}}` на сервер. Никакого warning'а. Узнаёшь только когда сервер отвечает 400 "invalid email format".

## Что сделать

Pre-flight check: при загрузке сьюта — список используемых vars vs доступных (env + captures + scope: shared если T65). Несоответствия:
- warning по умолчанию
- error при `--strict-vars`
- diagnose hint включает 'undefined variable' класс
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 {{nonexistent_var}} в YAML вызывает warning перед запросом, не silent literal
- [ ] #2 Опционально: --strict-vars делает hard-fail вместо warning
- [ ] #3 Test: missing var → exit code != 0 при --strict-vars
<!-- AC:END -->
