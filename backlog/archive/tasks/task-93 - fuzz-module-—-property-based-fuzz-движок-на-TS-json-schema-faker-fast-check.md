---
id: TASK-93
title: >-
  fuzz module — property-based fuzz движок на TS (json-schema-faker +
  fast-check)
status: To Do
assignee: []
created_date: '2026-04-29 13:29'
updated_date: '2026-04-29 14:06'
labels:
  - generator
  - probes
  - fuzz
dependencies:
  - TASK-58
  - TASK-92
milestone: m-5
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Stake-out: zond не догнать Schemathesis head-to-head, но 80% его ценности (property-based генерация + shrinking + контракт-валидация) укладывается в ~1.5–2к LoC TS поверх готовых кирпичей. Это позволяет остаться single-binary (Bun), не тащить Python/JVM, и иметь fuzz-результаты в общей SQLite-истории и run-diff'е zond.

См. контекст: 'Top OpenAPI Testing Tools 2026', независимые бенчмарки EvoMaster/Schemathesis, ROI-анализ TS-альтернатив (нет полноценного аналога Schemathesis на TS, но есть кирпичи).

## Что делать

Ввести модуль `src/core/probe/fuzz/` со следующей архитектурой:

```
src/core/probe/fuzz/
  generator.ts   ← валидные/невалидные значения по JSON Schema
  mutator.ts     ← boundary / type-confusion / null-byte / length / encoding мутации
  shrinker.ts    ← минимизация failing input через delta-debugging
  oracle.ts      ← классификация ответа (5xx, schema-violation, leak, timeout)
  pipeline.ts    ← оркестратор: generate → send → classify → shrink → report
  cli.ts         ← `zond probe-fuzz <spec>`
```

### Зависимости (новые)

- **json-schema-faker** (~5k stars, MIT, активный) — JSON Schema → реалистичные данные с учётом `format/pattern/enum/minimum/maximum`. Ядро generator.ts.
- **fast-check** (TS-стандарт property-based, активный, MIT) — arbitraries + shrinking-движок. Используется в shrinker.ts поверх существующего AJV.
- AJV (уже есть) — оракул контракта для response.
- @readme/openapi-parser (уже есть) — $ref-резолвинг.

### Mutator strategies (стартовый набор)

1. **Boundary** — min/max ± 1, длина строки на границе `maxLength`, пустые массивы/объекты.
2. **Type confusion** — int как string, string как array, null где требуется значение.
3. **Encoding** — null-byte (`\u0000`), эмодзи, unicode normalization edge cases, RTL-override.
4. **Format-specific** — email без `@`, URL с `javascript:`, UUID с лишним символом, ISO-date с timezone offset `+99:00`.
5. **Required-field removal** — убираем по одному required-полю.
6. **Extra fields** — переиспользует probe-mass-assignment (общий движок).

### Oracle (что считать багом)

- HTTP 5xx на любом fuzz-input — всегда баг.
- 2xx + response не валиден против response-schema (AJV) — контракт-баг.
- 4xx, но без content-type `application/json` или с пустым телом — soft-warn (UX-баг).
- Timeout / connection reset — баг.
- Response содержит подстроки из request (echo) при ошибке — potential leak. Soft-warn.

### Shrinker

- При найденном баге уменьшаем input через fast-check arbitraries: убираем поля по одному, подставляем минимальные значения, проверяем воспроизводимость.
- Гарантия: финальный repro — минимальный JSON, который всё ещё триггерит ту же классификацию.
- Сохраняем seed для детерминированного воспроизведения.

### Пайплайн

1. Парсим OpenAPI → список (endpoint, method, request-schema, response-schema).
2. Для каждого: используем существующую path-param discovery (TASK-92) для fixtures.
3. Generator выдаёт N валидных + M мутаций. Дефолт N=20, M=50, флагами регулируется.
4. Каждый запрос → existing runner (`core/runner`) → response → oracle.
5. На bug — shrinker уменьшает, сохраняет minimal repro.
6. Output: SQLite (общий с другими probe), JSON-envelope (для агента), опционально YAML-регресс-сьют для git.

### CLI

```
zond probe-fuzz <spec> [--budget N] [--seed S] [--export-regressions ./tests/]
                       [--include-pattern ...] [--exclude-pattern ...]
                       [--no-shrink] [--engine internal|schemathesis]
```

`--engine schemathesis` — будущий subprocess-fallback (отдельная задача), для тех, кому нужен максимальный recall.

### Интеграция с существующим стеком

- Переиспользовать `core/probe/lib/` (request building, classification skeleton).
- mass-assignment и validation-probe постепенно мигрировать на общий fuzz-engine — стратегия отличается, движок один.
- SQLite-runs: новый kind `fuzz`, тот же envelope-формат для diagnose / db diff.

## Acceptance

- Бинарь zond не вырастает на Python/JVM-зависимости — только npm-пакеты, Bun bundle.
- На spec без auth (publicly available toy API типа petstore) `zond probe-fuzz` за <30 секунд выдаёт ≥1 reproducible failure с минимальным input.
- Shrinker действительно уменьшает: тестом проверяем, что initial repro и shrunk repro оба триггерят одну классификацию, и shrunk строго меньше.
- Detected-bug envelope единый с probe-mass-assignment (поля `endpoint`, `severity`, `kind`, `request`, `response`, `repro_seed`).
- `--export-regressions` пишет YAML-сьюты, которые можно `zond run` без изменений.
- Документация в ZOND.md (раздел probe-команд + страница 'fuzz strategies').

## Scope-out (явно НЕ в этой задаче)

- White-box coverage / search-based генерация (EvoMaster-стиль).
- Stateful chain inference (отдельная будущая задача RESTler-lite).
- GraphQL fuzz.
- Интеграция со Schemathesis subprocess (будущая опциональная задача).

## Зависимости

- TASK-58 (mass-assignment) — общий движок мутаций, переиспользуем.
- TASK-92 (path-param auto-discovery) — без неё fuzz упрётся в те же INCONCLUSIVE.

## Метрика успеха (после реализации, отдельно)

Прогон на crAPI / juice-shop API → recall vs Schemathesis должен быть ≥60% на старте, ≥80% после нескольких итераций mutator-стратегий.
<!-- SECTION:DESCRIPTION:END -->
