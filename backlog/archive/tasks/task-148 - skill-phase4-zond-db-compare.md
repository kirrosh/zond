---
id: TASK-148
title: 'skill: явно прописать `zond db compare` в Phase 4 (regression diff)'
status: Done
assignee: []
updated_date: '2026-05-07'
labels:
  - skill
  - docs
milestone: m-8
dependencies: []
priority: low
---

## Description

## Контекст

Источник: [m-8 feedback §6 раунд 2 (skill)](../notes/m-8-audit-cli-gaps/feedback-original.md).

`zond db compare` — отличный инструмент для регрессионного diff'а
prev_run vs new_run после фикса. Но в скилле в Phase 4 он **не
упомянут** (только в `--help`). Легко забыть после применения фикса.

## Что сделать

В Phase 4 («Validate fix» / «Regression check») скилла:

1. После шага «применили фикс / получили зелёный run» добавить шаг:
   `zond db compare <prev_run_id> <new_run_id>` — посмотреть diff на
   уровне статусов/времён/captures.
2. Описать, что искать в выводе: исчезли ли FAIL'ы из prev, не
   появились ли новые fail'ы в шагах, которые в prev были PASS, нет
   ли регрессии по latency.
3. Дать пример вывода.

## Acceptance Criteria

- [ ] Phase 4 скилла упоминает `zond db compare` с примером.
- [ ] Описано, на что обращать внимание в diff'е.
