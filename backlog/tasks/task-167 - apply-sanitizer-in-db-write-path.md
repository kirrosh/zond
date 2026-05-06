---
id: TASK-167
title: apply sanitizer in DB-write path (results table)
status: To Do
assignee: []
created_date: '2026-05-06 06:55'
labels:
  - redaction
  - db
  - secrets
dependencies:
  - TASK-166
milestone: m-10
priority: high
---

## Description

## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §3.

Через `results` таблицу секрет может утечь в:
- `request_url` — token в query string (`?api_key=...`)
- `request_body` — credentials в теле refresh-token endpoint'а
- `response_body` — некоторые API эхо'ют Authorization в 401-ответе
- `response_headers` — `Set-Cookie`, `X-API-Token-Echo`
- `error_message`, `assertions`, `captures` — могут случайно содержать значение
- `spec_excerpt` — маловероятно, но возможно

Зависит от TASK-166 (registry) — после регистрации все INSERT в
`results` должны проходить через sanitizer.

## Что сделать

1. В `src/db/queries.ts` (или wrapper'е перед `insertResult`):
   - до записи в БД прогонять каждое поле через `registry.redact()`.
2. Поля: `request_url`, `request_body`, `response_body`,
   `response_headers`, `error_message`, `assertions`, `captures`.
3. **Не трогать** `request_method`, `response_status`, `duration_ms` (numeric/enum).
4. `--no-redact` флаг пропускает sanitizer.
5. Регрессионный тест: insert run где response_body содержит
   зарегистрированный токен → в БД лежит `<redacted:auth_token>`.
6. **Backward compat:** существующие runs (до фичи) не трогаются
   автоматически. Их чистит `zond redact` (TASK-171).

## Acceptance Criteria

- [ ] Все строковые поля `results` проходят через sanitizer перед INSERT.
- [ ] Регистрированный токен не попадает в БД ни через одно из полей.
- [ ] `--no-redact` сохраняет raw values (для локального дебага).
- [ ] Тест: prepared run с echo-payload → в БД нет raw-токена.
- [ ] Производительность: sanitizer не делает БД-write заметно медленнее (< 5% overhead на больших responses).
