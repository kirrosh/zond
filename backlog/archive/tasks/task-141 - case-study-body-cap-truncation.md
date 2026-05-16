---
id: TASK-141
title: 'zond report case-study --body-cap: truncate large response bodies'
status: Done
assignee: []
updated_date: '2026-05-07'
labels:
  - report
  - case-study
  - ux
milestone: m-8
dependencies: []
priority: medium
---

> **Note (2026-05-07):** scope сокращён до AC#1/#3 — флаг `--body-cap N` /
> `--no-body-cap` реализован в `src/cli/commands/report.ts:369-394`.
> Smart-mode (AC#2: сохранение полей assertions/captures из обрезаемого
> body) **не сделан** — выделить отдельным таском при появлении сигнала.

## Description

## Контекст

Источник: [m-8 feedback §E раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

`zond report case-study 3612` для `PUT /projects/.../` выдал 1100 строк
markdown потому что response — это весь project object с массивами
`features[]`/`plugins[]`. Релевантного — 2 строки (`subjectPrefix`).

## Что сделать

1. Опция `--body-cap <n>` (по умолчанию 200 строк / ~8 КБ) с placeholder'ом
   `... truncated, see run #X result #Y full body via 'zond db result <id> --body'`.
2. **Smart-mode** (флаг `--smart-body` или поведение по умолчанию):
   - В failure-блоке показывать только diff между ожиданием и фактом.
   - Поля, упомянутые в assertions / captures, оставлять полностью.
   - Остальные большие массивы — свернуть в `[<N> items elided]`.
3. Глобальный override `--no-body-cap` для случаев, когда нужен полный body.

## Acceptance Criteria

- [ ] `--body-cap N` ограничивает любой блок body в случае-стади.
- [ ] Smart-mode оставляет поля из assertions/captures полными,
      обрезает остальное.
- [ ] Placeholder ссылается на способ получить full body.
- [ ] Тесты на 3 кейса: small body (не обрезается), large body
      (обрезается), large body с assertions на конкретные поля
      (поля целы, остальное обрезано).
- [ ] CHANGELOG.
