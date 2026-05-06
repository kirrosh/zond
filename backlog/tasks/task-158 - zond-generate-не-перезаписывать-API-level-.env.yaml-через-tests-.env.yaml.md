---
id: TASK-158
title: 'zond generate: не перезаписывать API-level .env.yaml через tests/.env.yaml'
status: To Do
assignee: []
created_date: '2026-05-06 06:38'
labels:
  - lifecycle
  - generate
  - env
  - bug
dependencies: []
milestone: m-9
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P2.

На первой генерации появляется `apis/<name>/tests/.env.yaml` с
`# TODO: fill` плейсхолдерами. Из-за «deeper override» он
перебивает API-level `apis/<name>/.env.yaml`. Поведение сейчас не
«merge», а «полная перезапись» — пользователь вынужден удалять
руками.

## Что сделать

1. **Не создавать `tests/.env.yaml` если API-level уже существует.**
   API-level `.env.yaml` — единственный source of truth для
   runtime-переменных.
2. Если API-level отсутствует — создать там, не в `tests/`.
3. Альтернатива: если `tests/.env.yaml` нужен (deeper-scope merge) —
   merge поверх API-level, а не override; и не писать TODO-значения
   для уже заполненных переменных.

## Acceptance Criteria

- [ ] После `zond generate` `tests/.env.yaml` не создаётся, если API-level есть.
- [ ] API-level `.env.yaml` сохраняет существующие значения после re-generate.
- [ ] Если deeper-scope merge нужен — задокументирован с явным merge-поведением.
<!-- SECTION:DESCRIPTION:END -->
