---
id: TASK-88
title: adaptive rate-limit — window-aware throttle (follow-up T81)
status: Done
assignee: []
created_date: '2026-04-29 11:39'
updated_date: '2026-04-29 11:52'
labels:
  - runner
  - rate-limit
  - follow-up
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

TASK-81 добавил чтение `RateLimit-Remaining` / `RateLimit-Reset` headers (RFC draft) и адаптивную паузу при `remaining ≤ 5`. Round-2 показал, что для window-based лимитов вида Resend (5 requests / 1 second) этого недостаточно: probe-suite успевает накопить burst быстрее, чем мы реагируем, и сваливается в 429.

Варианты, которые надо рассмотреть:

- **Snug threshold:** при `remaining ≤ 2` спать `RateLimit-Reset` секунд (а не пытаться продолжить). Простой patch.
- **Token-bucket с burst=1:** при policy `N;w=W` (либо при наблюдении лимита) считать spacing = `W/N + safety_margin` и держать его независимо от headers. Это устраняет burst как класс — каждый запрос идёт ровно по графику.
- **Retry-on-429 c Retry-After:** уже частично есть (TASK-25), но нужно ещё агрессивнее уважать `Retry-After` поверх heuristic backoff, плюс не считать 429-retry неуспехом suite.

## Что сделать

- Расширить `core/runner/rate-limiter.ts`:
  - парсить `RateLimit-Policy: N;w=W` (RFC draft) и выводить spacing, если меньше текущего;
  - триггерить `await Bun.sleep(reset_ms)` при `remaining ≤ 2` (или конфигурируемый порог).
- Тест: моковый сервер, который возвращает headers Resend-like (5/1s) — убедиться, что 100 probe-запросов проходят без 429.
- Обновить `ZOND.md` раздел про `--rate-limit auto`: явно описать, что мы делаем при `remaining ≤ 2` и при наличии policy.

## Acceptance

- На window-based лимите (5/1s, 10/10s) probe-suite не получает 429 при `--rate-limit auto`.
- `--rate-limit auto --rate-limit-burst 1` или эквивалентный режим документирован как рекомендуемый для production-API без статического лимита.
<!-- SECTION:DESCRIPTION:END -->
