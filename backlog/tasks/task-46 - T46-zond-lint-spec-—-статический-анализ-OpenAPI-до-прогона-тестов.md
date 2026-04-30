---
id: TASK-46
title: 'T46: zond lint-spec — статический анализ OpenAPI до прогона тестов'
status: In Progress
assignee: []
created_date: '2026-04-27 16:42'
updated_date: '2026-04-30 11:39'
labels:
  - spec-validation
  - bug-hunting
milestone: m-4
dependencies:
  - TASK-94
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Schemathesis vs zond benchmark на Resend показал: большинство «багов спеки» детектятся
**детерминированно** — без property-based fuzz, просто обходом OpenAPI-документа.
Два класса проблем:

- **Internal consistency** — спека сама себе противоречит. Пример: B12 (Resend
  bug #01) — `created_at example: "2023-10-06:23:47:56.678Z"` (Postgres-формат)
  при `format: date-time` (RFC3339).

- **Strictness gaps** — спека слишком слабая, схема пропускает то, что сервер
  отвергает 422. Пример: B13 — Schemathesis нашёл 24 path с `RejectedPositiveData`
  (path-params без `format: uuid`, query `limit` без `minimum/maximum`,
  cursor-params без `minLength`). SDK, сгенерированные по такой спеке, принимают
  невалидные значения и шлют их на сервер.

Команды `zond lint-spec` пока **нет** (greenfield-фича).

## Что сделать

Команда `zond lint-spec <spec> [--json] [--strict] [--rule R1,!R2,...]`.

Один проход по OpenAPI, два ортогональных набора правил.

### Group A — internal consistency

| ID | Правило | Severity |
|---|---|---|
| A1 | `example` matches `format` (date-time RFC3339, email, uri, uuid, ipv4, hostname) | high |
| A2 | `example` matches `enum` | high |
| A3 | `example` matches `pattern` (regex compiles + matches) | medium |
| A4 | `example` matches `minLength` / `maxLength` / `minimum` / `maximum` | medium |
| A5 | `default` matches те же constraints что и A1–A4 | medium |
| A6 | `enum` values pairwise unique | low |

Format-валидация переиспользует `STRICT_RFC3339_DATE_TIME` из
`src/core/runner/schema-validator.ts` (TASK-94) + ajv-formats для остальных.

### Group B — strictness gaps

| ID | Правило | Severity |
|---|---|---|
| B1 | path-параметр (`in: path`) без `format` и без `pattern` | high |
| B2 | path/query параметр с именем `*_id` / `id` без `format: uuid` или `pattern` | medium (heuristic) |
| B3 | integer-параметр без `minimum`/`maximum`, особенно `limit`, `offset`, `page`, `size`, `count`, `per_page` | medium |
| B4 | string-параметр `after`/`before`/`cursor`/`token` без `minLength: 1` | low |
| B5 | string-поле с именем `*_at`, `*_date`, `created`, `updated`, `timestamp` без `format: date-time` | medium |
| B6 | string-поле с именем `email`, `url`, `website`, `homepage` без соответствующего `format` | low |
| B7 | 2xx response без schema (`content: {}` или отсутствует) | high |
| B8 | request-body schema без явного `additionalProperties` (связано с mass-assignment, T58) | low (informational) |
| B9 | request-body required-fields пусто, но в properties есть «семантически обязательные» (`name`, `email`) | low (heuristic) |

Heuristic-правила (B2, B5, B6, B9) — это whitelist префиксов/суффиксов
(`HEURISTIC_NAME_HINTS`), легко отключаемый через `--rule !B2,!B5,!B6,!B9`
и расширяемый через конфиг.

### Архитектура

```
src/core/lint/
  index.ts          ← entry: lintSpec(doc) -> Issue[]
  rules/
    consistency.ts  ← Group A
    strictness.ts   ← Group B
    heuristics.ts   ← name-based hints (отключаемы)
  walker.ts         ← обход OpenAPI: paths → operations → params → schemas (с $ref)
  format.ts         ← format-validators (date-time strict, email, uri, uuid, ...)
  reporter.ts       ← human / json output
src/cli/commands/lint-spec.ts
```

### CLI

```
zond lint-spec <spec>
                [--json]                       # NDJSON / structured output
                [--strict]                     # exit 1 даже на medium/low
                [--rule R1,!R2]                # selective enable/disable
                [--config .zond-lint.json]     # per-project rule config
                [--include-path PATTERN]       # glob path filter
                [--max-issues N]
```

Exit-codes:
- `0` — issues нет, или есть только LOW и не передан `--strict`.
- `1` — есть HIGH (CI fail).
- `2` — есть MEDIUM (или LOW при `--strict`).

### Output (human)

```
❌ HIGH (3)
  /webhooks/{id}                       path-param "id" missing format/pattern (B1)
  /audiences POST responses.201        schema absent for 2xx (B7)
  /domains created_at example          "2023-10-06:23:47:56.678Z" violates format: date-time (A1)

⚠️  MEDIUM (8)
  /contacts.get  parameters[limit]     integer without minimum/maximum (B3)
  /contacts.get  parameters[after]     cursor missing minLength: 1 (B4)
  ...

ℹ️  LOW (4)
  /domains.get   response.data[].verified_at   field "*_at" missing format: date-time (B5, heuristic)
  ...

23 issues across 17 endpoints
```

### Output (--json, NDJSON)

```json
{"rule":"B1","severity":"high","path":"/webhooks/{id}","jsonpointer":"/paths/~1webhooks~1{id}/parameters/0","message":"path-param \"id\" missing format/pattern","fix_hint":"add format: uuid or pattern: ^[0-9a-f-]{36}$"}
```

Поле `jsonpointer` — RFC6901, чтобы агент / IDE могли точечно открыть место в документе.

### Конфиг (`.zond-lint.json` опционально)

```json
{
  "rules": { "B2": "off", "B5": "warn" },
  "heuristics": {
    "id_suffixes": ["_id", "Id"],
    "timestamp_suffixes": ["_at", "_date"],
    "url_names": ["url", "website", "homepage"]
  },
  "ignore_paths": ["/internal/*"]
}
```

### Что переиспользуем

- `@readme/openapi-parser` — уже подключён, `$ref`-резолвинг сделан.
- AJV + ajv-formats — уже есть. Strict date-time из TASK-94 (`STRICT_RFC3339_DATE_TIME`).
- Reporter-стиль (human/json envelope) — общий с probe-командами.
- SQLite history — пишем lint-runs туда же, для diff-режима в будущем (`zond db lint-diff`).

## Acceptance

- На Resend openapi.json:
  - Ловит B12 / bug #01 (Postgres timestamp в example) через A1.
  - Находит ≥20 issues класса B1/B3/B4 на path-params и query-params (соответствует
    24 path'ам RejectedPositiveData из Schemathesis benchmark).
  - Поле `jsonpointer` указывает на точное место в документе.

- На petstore.json (эталонная good-spec) — 0 HIGH, минимум LOW.

- `--json` дает структурный output, парсится агентом без regex'ов.

- `--rule !B2,!B5,!B6,!B9` отключает все heuristic-правила; запуск становится
  чисто формальным.

- Exit-codes соответствуют CI-сценарию: `zond lint-spec spec.json` → 1 на HIGH,
  документировано.

- Документация в ZOND.md (новый раздел) и в README (Key Capabilities).

## Не в scope

- Auto-fix (`zond lint-spec --fix`) — отдельная будущая задача.
- Linting OpenAPI 2.0 (Swagger) — только 3.0 + 3.1.
- Spectral-style custom rules через JSONPath — overkill, дублирует Spectral.
- Cross-endpoint consistency (одно и то же поле — разные типы в разных местах)
  — отдельная задача, T51 уже про это.

## Зависимости

- TASK-94 (Done) — strict RFC3339 валидатор, переиспользуем для A1.
- TASK-58 (Done) — informational связь B8 с mass-assignment.

## Стоимость и метрика

- Group A: ~300 LoC + тесты. 0.5 дня.
- Group B + walker + heuristics: ~700 LoC + тесты. 1.5 дня.
- CLI + reporter: ~200 LoC. 0.5 дня.
- Итого: 2–3 дня.

**Метрика успеха:** на Resend openapi.json `zond lint-spec` находит ≥30 issues
до прогона тестов. После того как Resend применит исправления, категория
Schemathesis `positive_data_acceptance` (24 path) и `JsonSchemaError` (5 path)
схлопываются. То есть `zond lint-spec` устраняет источник, а не последствия.
<!-- SECTION:DESCRIPTION:END -->
