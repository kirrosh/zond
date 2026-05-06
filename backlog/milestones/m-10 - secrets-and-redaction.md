---
id: m-10
title: "secrets-and-redaction"
---

## Description

Секреты и auto-redaction в persisted artifacts. Источник правды:
[notes/m-10-secrets-and-redaction/feedback-original.md](../notes/m-10-secrets-and-redaction/feedback-original.md)
(round 5, agent perspective, 2026-05-06).

Главный вывод: **redaction first, split files second.** Сейчас
runtime-секреты (auth_token, dsn) сами лежат в `.env.yaml` plain-text,
и **в коде zond нет ни одной точки redaction'а** — токен может
утечь через `request_url` (query token), `request_body`,
`response_body` (echo на 401), `response_headers` (Set-Cookie),
stdout `--verbose`, JSON/HTML/JUnit-export, case-study `.md`. Любая
новая echo-точка автоматически становится утечкой.

Сценарий-боль: пользователь хочет поделиться HTML-report'ом с
коллегой → надо вручную чистить от Bearer-токенов в десятках мест.
Должно быть «дать HTML — безопасно по умолчанию».

### Цели майлстоуна

1. **Redaction-инфраструктура (P0).** Реестр секретных значений в
   runtime + единый sanitizer. Применяется в DB-write path, во всех
   exporter'ах (HTML, JSON, JUnit, case-study, digest), в stdout
   `--verbose`. Маркер: `<redacted:auth_token>` (имя var, не raw).
2. **`${ENV_VAR}` + `@secret:<name>` references в `.env.yaml`.**
   `${SENTRY_AUTH_TOKEN}` — из shell env. `@secret:auth_token` — из
   `.secrets.yaml`. После имплементации `.env.yaml` можно коммитить
   (только references).
3. **`.secrets.yaml`** — отдельный gitignored файл, всё содержимое
   авто-помечается как secret в registry. Чёткая ментальная модель:
   «положил сюда — не появится в артефактах».
4. **`.identity.yaml`** (org_slug, member_id) — отдельный файл +
   opt-in `--redact-identity` в report-командах. Локальный триаж
   видит identity; outbound-шеринг — placeholder'ы.
5. **`zond redact`** для миграции существующих воркспейсов
   (zond.db + triage/).
6. **`zond doctor`** показывает секреты как metadata
   (`auth_token: set, 64 chars`) вместо raw.
7. **Skill catch-up.** Агент должен уметь работать с references и
   metadata, не запрашивать raw-секреты.

### Не покрывает

- 1Password / keychain integrations (`@op:`, `@keychain:`) — отдельный
  follow-up майлстоун, пока только `${ENV}` и `@secret:`.
- Шифрование zond.db at rest.
- File-lifecycle (m-9).
- CLI-gaps (m-8).

### Точка входа для агента

Перед стартом задачи — прочитать
[feedback-original.md](../notes/m-10-secrets-and-redaction/feedback-original.md),
секции «Где сейчас токен утекает по факту» и «3. Auto-redaction в
любом persisted artifact». Уточнение из ревью кода в начале файла:
`request_headers` в `results` НЕ хранится — но `request_url`,
`request_body`, `response_body`, `response_headers` хранятся, и любой
из них может содержать echo секрета.
