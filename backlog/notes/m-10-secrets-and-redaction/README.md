---
id: m-10-notes
title: "m-10 secrets-and-redaction notes"
---

# m-10 secrets-and-redaction — заметки

## Файлы

- [feedback-original.md](feedback-original.md) — отзыв агента после
  работы с Sentry-воркспейсом (round 5, agent perspective,
  2026-05-06). Не трогать (исторический документ).

## Карта фидбэк → задачи

| Раздел фидбэка | Приоритет | Задача |
|---|---|---|
| §3 redaction registry + sanitizer (P0) | HIGH | TASK-166 |
| §3 sanitizer в DB-write path | HIGH | TASK-167 |
| §3 sanitizer в exporters (HTML/JSON/JUnit/case-study/digest) | HIGH | TASK-168 |
| §2 `${ENV_VAR}` substitution | MEDIUM | TASK-169 |
| §1+§2 `@secret:` + `.secrets.yaml` | MEDIUM | TASK-170 |
| миграция: `zond redact` для существующих artifacts | LOW | TASK-171 (depends 166, 170) |
| §5 `zond doctor` metadata-only для секретов | LOW | TASK-172 |
| §6 `--redact-identity` opt-in flag | LOW | TASK-173 (depends 174) |
| §1+§6 `.identity.yaml` файл | MEDIUM | TASK-174 |
| skill catch-up | MEDIUM | TASK-175 (depends 166, 169, 170, 172, 174) |

## Точка входа

Перед началом задачи — прочитать
[feedback-original.md](feedback-original.md), секции «Где сейчас
токен утекает по факту» и «3. Auto-redaction в любом persisted
artifact».

**Уточнение из ревью кода (важно):** в текущей схеме `results`
хранится только `response_headers`, не `request_headers`. HTML-export
тоже рендерит только response. То есть `Authorization: Bearer …`
через headers в БД/HTML напрямую **не утекает**. Утечки через:
`request_url` (token в query), `request_body`, `response_body` (echo
на 401), `response_headers` (Set-Cookie), stdout `--verbose`. Список
полей для sanitizer'а в TASK-167.

## Граф зависимостей

```
TASK-166 (registry)
├─ TASK-167 (DB-write sanitizer)        — HIGH
├─ TASK-168 (exporter sanitizer)        — HIGH
├─ TASK-169 (${ENV})                    — MEDIUM
├─ TASK-170 (@secret + .secrets.yaml)   — MEDIUM
│   └─ TASK-171 (zond redact migration) — LOW
├─ TASK-172 (doctor metadata)           — LOW
└─ TASK-174 (.identity.yaml)            — MEDIUM
    └─ TASK-173 (--redact-identity)     — LOW

TASK-175 (skill) — finale, depends [166, 169, 170, 172, 174]
```
