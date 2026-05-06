---
id: TASK-164
title: 'report HTML --body-cap: truncate response bodies'
status: To Do
assignee: []
created_date: '2026-05-06 06:39'
labels:
  - lifecycle
  - report
  - html
  - size
dependencies:
  - TASK-141
milestone: m-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P8.

`triage/sentry-run-12-smoke-sequential.html = 921 KB`. Главный
виновник — full response bodies (Sentry возвращает 30+ KB на GET
`/projects/`, со всеми features/plugins). 90% bloat без потери
триаж-сигнала.

TASK-141 уже добавляет `--body-cap` для case-study; эта задача —
расширение на HTML run-export.

## Что сделать

1. `zond report html <run-id> --body-cap <n>` — обрезать каждый
   response body до N байт (default: 4096? 8192?).
2. Truncated body показывается с маркером:
   ```
   [truncated 28432 bytes; first 4096 shown; full body in run DB]
   ```
3. Применять и к request body (для POST/PUT).
4. Дефолт включён (`--body-cap 8192`); `--no-body-cap` для full body.
5. Применимо и к case-study (унификация с TASK-141 — единый флаг).

## Acceptance Criteria

- [ ] `zond report html` поддерживает `--body-cap <n>` и `--no-body-cap`.
- [ ] Дефолт включает разумный cap (≤ 8 KB на body).
- [ ] Размер HTML-export'а на Sentry-runner падает в ≥ 5 раз.
- [ ] Truncation marker виден в HTML.
- [ ] Флаг унифицирован с case-study (TASK-141).
<!-- SECTION:DESCRIPTION:END -->
