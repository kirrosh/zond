---
id: TASK-92
title: 'probe-команды: auto-discovery path-param fixtures через GET-on-list'
status: To Do
assignee: []
created_date: '2026-04-29 12:46'
labels:
  - bug-hunting
  - probes
  - ergonomics
dependencies:
  - TASK-32
  - TASK-65
  - TASK-58
milestone: m-5
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После TASK-58 (mass-assignment probe) ~20 endpoint'ов уходят в INCONCLUSIVE из-за отсутствия path-param fixtures (`{domain_id}`, `{webhook_id}`, `{template_id}`, `{audience_id}`, ...). Половина из них тривиально решается через `GET /domains` → взять `data[0].id`. Без авто-дискавери probe-классы упираются в ту же fixture-проблему — ручной труд блокирует выкатку новых probe (T59 SSRF, T60 CRLF, T63 auth-scope).

## Что сделать

Расширить probe-runtime (общая инфраструктура для probe-mass-assignment, probe-validation, будущих probe-команд) автодискавером path-параметров:

1. Перед тем как пометить endpoint INCONCLUSIVE из-за missing path-param, попробовать найти `GET /collection` в спеке (по convention: убрать последний `/{id}` сегмент).
2. Сделать `GET /collection?limit=1` (или без query, если `limit` не в спеке), вытащить `data[0].id` (configurable JSON-path).
3. Закэшировать discovered ID на время run'а — один `GET /domains` обслуживает все endpoints с `{domain_id}`.
4. Если list пустой / 4xx / endpoint не найден — fallback на текущий INCONCLUSIVE с явным сообщением `fixture_domain_id required (auto-discovery: empty list)`.
5. CLI-флаг `--no-discover` для отключения (когда side-effects на GET нежелательны).

## Альтернатива

Переиспользовать механизм TASK-32 / TASK-65 (`scope: shared` fixture-сьюты): probe-команды читают тот же run-scope, что и сгенерированные setup-сьюты. Тогда T92 — это интеграция probe-runtime с общим discovery pipeline, а не отдельная реализация.

## Acceptance

- На API с list-эндпоинтами доля INCONCLUSIVE из-за missing path-params падает на ≥80% без ручной правки `.env.yaml`.
- Один `GET /collection` на ресурс за run (кэш).
- Graceful fallback на пустом list / отсутствии list-эндпоинта — INCONCLUSIVE с явным reason.
- `--no-discover` отключает поведение.
- Документация в ZOND.md (раздел probe-команд).

## Зависимости

- TASK-32 — discovery-механика для positive-smoke (переиспользовать reasoning о JSON-path / list-detection).
- TASK-65 — cross-suite capture propagation (probe-runtime может читать из shared scope).
- TASK-58 — probe-mass-assignment (первый потребитель).
<!-- SECTION:DESCRIPTION:END -->
