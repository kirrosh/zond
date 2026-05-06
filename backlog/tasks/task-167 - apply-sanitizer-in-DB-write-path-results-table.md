---
id: TASK-167
title: apply sanitizer in DB-write path (results table)
status: Done
assignee: []
created_date: '2026-05-06 06:55'
updated_date: '2026-05-06 10:07'
labels:
  - redaction
  - db
  - secrets
milestone: m-10
dependencies:
  - TASK-166
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
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
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Все строковые поля `results` проходят через sanitizer перед INSERT.
- [ ] #2 Регистрированный токен не попадает в БД ни через одно из полей.
- [ ] #3 `--no-redact` сохраняет raw values (для локального дебага).
- [ ] #4 Тест: prepared run с echo-payload → в БД нет raw-токена.
- [ ] #5 Производительность: sanitizer не делает БД-write заметно медленнее (< 5% overhead на больших responses).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
saveResults() в src/db/queries.ts: redactString/redactJson обёртки вокруг каждого potentially-leaky поля (request_url/body, response_body/headers, error_message, assertions, captures, spec_excerpt). Numeric/enum поля не трогаются. Registry заполняется в execute-run.ts через registerAll(env). 3 новых регрессионных теста. Микробенчмарк: 0.027ms/call на 50KB body — <1% overhead, в рамках 5% acceptance criteria. 993/993 tests pass.
<!-- SECTION:NOTES:END -->
