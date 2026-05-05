---
id: TASK-144
title: '--retry-on-network <N>: авто-повтор при ECONNRESET / socket close'
status: To Do
assignee: []
labels:
  - run
  - reliability
milestone: m-8
dependencies: []
priority: medium
---

## Description

## Контекст

Источник: [m-8 feedback §H раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

В Sentry-аудите `--w` parallel первый smoke дал 17 `network_errors`. При
`--sequential` все исчезли (значит транзитные TCP-проблемы). Сейчас
никакого встроенного retry нет — пользователь узнаёт об этом, только
прогнав второй раз.

## Что сделать

1. Флаг `zond run --retry-on-network <N>` (default 1, можно 0 для off).
2. Срабатывает **только** при ошибках уровня сети:
   `ECONNRESET`, `EPIPE`, `socket hang up`, `fetch failed` без HTTP-ответа,
   timeout без ответа.
3. **НЕ** срабатывает на HTTP-кодах (5xx — это валидный ответ, не сеть).
4. Backoff: экспоненциальный с jitter, базово 250ms.
5. В отчёте помечать retry-степы (`network_retry: 1` в metadata) —
   чтобы было видно, что shell прошёл, но первый attempt был сетевой.
6. Полезно интегрировать с `--rate-limit auto` (если 429 — это HTTP,
   ретрай делает rate-limiter; сетевой ретрай отдельный путь).

## Acceptance Criteria

- [ ] Флаг работает, default = 1.
- [ ] Только сетевые ошибки ретраятся, HTTP-коды не трогаются.
- [ ] Тест с моком, поднимающим `ECONNRESET` на первом attempt'е.
- [ ] Тест на отсутствие ретрая для 502.
- [ ] В run-результатах виден `network_retry` count.
- [ ] CHANGELOG.
