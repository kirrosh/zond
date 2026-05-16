---
id: TASK-94
title: >-
  validate-schema: strict format-валидация (date-time, uuid, email, ipv4, ...)
  через ajv-formats
status: Done
assignee: []
created_date: '2026-04-29 13:44'
updated_date: '2026-04-29 13:52'
labels:
  - validator
  - quality
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В benchmark Schemathesis vs zond на Resend Schemathesis нашёл B12 — `created_at` в response в PostgreSQL-формате (`'2026-04-29 07:10:44.674675+00'`), а спека объявляет `format: date-time` (RFC3339). Затронуто /api-keys, /audiences, /logs, /segments — системно. Реальный impact: строгий `time.Parse(time.RFC3339, …)` в Go-SDK сломается.

zond пропустил, потому что `--validate-schema` валидирует через AJV, но format-checks либо не в strict-режиме, либо часть форматов отключена. У нас уже подключены `ajv` и `ajv-formats` — фикс на уровне конфигурации.

Агент в предыдущих ручных итерациях этот баг тоже замечал — значит он визуально очевиден, проблема в отсутствии систематической проверки.

## Что сделать

1. В месте инициализации AJV (искать `new Ajv` / `addFormats`) включить:
   - `ajv-formats` со всеми relevant форматами: `date-time, date, time, email, uri, uuid, ipv4, ipv6, hostname`.
   - `strict: true` или `validateFormats: true` — чтобы формат не был warning'ом, а валил ассерт.
2. Убедиться что format-violation попадает в run-output как отдельный класс failure (`format_conformance`), не сваливается в общий `schema_conformance` без деталей.
3. Тест: фикстура с response `{created_at: '2026-04-29 07:10:44.674675+00'}` и schema `{format: date-time}` → `zond run --validate-schema` падает с понятным сообщением 'date-time format violation: expected RFC3339, got PostgreSQL-style'.
4. Дока в ZOND.md (раздел --validate-schema): какие форматы strict, как отключить (`--no-format-check` или per-format).

## Acceptance

- На Resend openapi.json `zond run --validate-schema` ловит B12 без всяких probe-команд.
- Failure-классификация: `format: date-time` отдельно от `type` / `required` / `enum`.
- Backwards-compatible флаг для отключения strict (для случаев когда спека сама врёт).

## Не в этой задаче

- Fuzz / property-based (TASK-93).
- Format-aware request generation — это TASK-26 (Done) для request, для response отдельная фича не нужна, AJV сам справляется.

## ROI

Час работы — закрывает целый класс багов на каждом API с timestamps в response. Дешевле и эффективнее, чем целый fuzz-движок.
<!-- SECTION:DESCRIPTION:END -->
