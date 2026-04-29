---
id: TASK-66
title: 'T66: duration_ms timing assertions + side-channel detection'
status: To Do
assignee: []
created_date: '2026-04-29 08:35'
labels:
  - bug-hunting
  - runner
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

zond пишет duration_ms в БД, но в YAML нет способа assert'ить таймиг. Это нужно для:
1. Side-channel detection в SSRF/блайнд-пробах: 4xx ответ с длительной задержкой = сервер реально пытался стучаться на target (timeout).
2. Performance regression detection в smoke: `duration_ms < 500` для health-эндпоинтов.
3. Per-probe baseline для probe-команд (T59 SSRF особенно): сравнение с медианой обычных запросов.

## Что сделать

1. Новые assertion'ы на уровне expect:
   ```yaml
   expect:
     status: 4xx
     duration_ms: { lt: 500 }
     # или { gt: 5000 } для blind-detection
   ```
2. Семантика: проверяется поверх существующих assertions, не заменяет их.
3. Опционально: per-suite baseline — runner накапливает медиану по suite, второй прогон сравнивает с baseline. Аномалии помечаются как warnings.
4. Reporter: timing-аномалии surface'ятся отдельно в console + JSON-report.
5. Интеграция с T59 (SSRF probe): автоматическое generation timing-assert'а с порогом >2× медианы.

## Acceptance

- duration_ms assertion работает как обычный (lt/gt/equals).
- Surface'ится в console и JSON reporter.
- Интегрируется с probe-командами для side-channel detection.
- Документация в ZOND.md (Assertions section).
<!-- SECTION:DESCRIPTION:END -->
