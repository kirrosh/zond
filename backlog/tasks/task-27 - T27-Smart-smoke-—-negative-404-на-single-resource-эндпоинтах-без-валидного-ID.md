---
id: TASK-27
title: 'T27: Smart smoke — negative-404 на single-resource эндпоинтах без валидного ID'
status: To Do
assignee: []
created_date: '2026-04-27 13:42'
labels:
  - generator
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Для эндпоинтов вида `GET /emails/{email_id}` генератор подставляет placeholder из `.env.yaml` и ставит `expect: status: 200`. На пустом аккаунте без реального ID это гарантированный фейл (~15 фейлов из 45 на первом прогоне Resend).

## Что сделать

Логика в `zond generate`:

1. Если path-параметр `{xxx_id}` есть в `.env.yaml` И значение **не** placeholder (не `example`, не пустое) → ставить `expect: 200` как сейчас.
2. Иначе → ставить `expect: 404` (negative smoke) и помечать `# TODO: replace ID and change expect to 200`.

Альтернатива: тег `[needs-id]` для таких сьютов, чтобы их можно было фильтровать.

## Acceptance

- Первый прогон сгенерированных smoke-тестов на пустом аккаунте даёт ≥90% pass rate (вместо текущих ~33%).
- Если пользователь подставит реальные ID и переключит expect, сьюты остаются совместимыми.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Эвристика placeholder-detection работает
- [ ] #2 Negative-smoke помечается понятным TODO/тегом
- [ ] #3 Документация описывает workflow обновления expect после ввода реальных ID
<!-- AC:END -->
