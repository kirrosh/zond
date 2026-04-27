---
id: TASK-46
title: 'T46: zond lint-spec — проверка example vs format в OpenAPI'
status: To Do
assignee: []
created_date: '2026-04-27 16:42'
labels:
  - spec-validation
  - bug-hunting
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Bug #01 в Resend: `created_at` example в spec — `"2023-10-06:23:47:56.678Z"` (Postgres-формат, **не RFC 3339**). format: date-time. Если бы spec-validator у нас был, поймали бы баг до прогона тестов.

## Что сделать

Команда `zond lint-spec <spec>`:

1. Walk все `example:` поля в спеке (на всех уровнях: request body, response, parameters).
2. Для каждого с `format:` проверить соответствие:
   - `format: date-time` → RFC 3339 (parse via `Date.parse` + structural regex).
   - `format: email` → basic RFC 5322.
   - `format: uri` / `url` → URL constructor.
   - `format: uuid` → UUID v4 regex.
   - `format: ipv4` → octet check.
   - `format: hostname` → RFC 952/1123.
3. Также проверить consistency `example` vs `enum`, `example` vs `pattern`, `example` vs `minLength/maxLength`.
4. Output: список нарушений с paths.

Использование:
```bash
zond lint-spec openapi.json
# → Found 3 example/format mismatches:
#   paths./domains/{id}.get.responses.200.content.application/json.schema.properties.created_at.example
#     value "2023-10-06:23:47:56.678Z" doesn't match format: date-time (RFC 3339 expected)
```

## Acceptance

- На Resend spec ловит bug #01 (Postgres timestamp в example).
- Json-output для CI: `zond lint-spec spec.json --json`.
- Exit 1 если нарушения найдены (для CI).
- Документация.
<!-- SECTION:DESCRIPTION:END -->
