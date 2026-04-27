---
id: TASK-45
title: 'T45: zond fuzz — property-based body fuzzer с shrink на 5xx'
status: To Do
assignee: []
created_date: '2026-04-27 16:42'
labels:
  - fuzzer
  - bug-hunting
milestone: m-4
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Live-сессия на Resend выявила bug #05: POST /webhooks с invalid event name → HTTP 500. Это не singularity — это паттерн (вероятно invalid endpoint URL длиной 10000 символов, malformed JSON, и т.д. дадут тот же 500). Систематически такие баги ловит property-based fuzzer.

`zond` сейчас генерирует **один** валидный body на endpoint. Чтобы найти класс unhandled-exception bug'ов, нужна команда, которая берёт spec, генерирует **N рандомизированных** тел, шлёт, и при 5xx **shrink'ит** до минимального воспроизводящего ввода.

## Что сделать

Новая команда `zond fuzz <spec>`:

1. Для каждого POST/PUT/PATCH endpoint: сгенерировать 50-100 рандомизированных тел через property-based стратегии:
   - Boundary values: `""`, `null`, очень длинные строки, отрицательные числа, max int.
   - Type confusion: string там где integer, array там где object.
   - Unicode/emoji/RTL/zero-width.
   - Malformed format: invalid UUID, invalid email, malformed URL.
   - Required field absent.
2. Логировать только **5xx** ответы (4xx — ожидаемая валидация).
3. На каждом 5xx — **shrink** алгоритм: бинарным поиском упрощать тело до минимального, всё ещё дающего 5xx.
4. Output: `bugs/fuzz-<endpoint>-<timestamp>.yaml` с минимальным repro + сводный отчёт.

Использование:
```bash
zond fuzz openapi.json --tag webhooks --iterations 100 --output bugs/
```

Опционально интегрировать с rate-limit (T25).

## Acceptance

- На API с известным 500-багом fuzzer находит и shrink'ит до минимального ввода.
- Output — runnable zond YAML, можно закоммитить как regression-test.
- 4xx ответы не логируются (это ожидаемая валидация).
- Документация в ZOND.md.
<!-- SECTION:DESCRIPTION:END -->
