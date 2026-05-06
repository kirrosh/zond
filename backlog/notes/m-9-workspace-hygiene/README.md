---
id: m-9-notes
title: "m-9 workspace-hygiene notes"
---

# m-9 workspace-hygiene — заметки

## Файлы

- [feedback-original.md](feedback-original.md) — структурный обзор
  воркспейса после ~6 раундов экспериментов с Sentry Public API
  (round 5, file-lifecycle review, 2026-05-06). Не трогать
  (исторический документ).

## Карта фидбэк → задачи

| Раздел фидбэка | Приоритет | Задача |
|---|---|---|
| §P9 zond clean + §P10 manifest | HIGH | TASK-156 |
| §P1 tests/.api-catalog.yaml дубликат | HIGH | TASK-157 |
| §P2 tests/.env.yaml перезаписывает API-level | HIGH | TASK-158 |
| §P3 by-id × N в именах probe-файлов | MEDIUM | TASK-159 |
| §P4 DRY в probe-suites (extends:) | LOW | TASK-160 |
| §P5 пустые --emit-tests/ директории | LOW | TASK-161 |
| §P6 auto-rotation digest'ов | MEDIUM | TASK-162 |
| §P7 default triage/<api>/<run>/ | MEDIUM | TASK-163 |
| §P8 --body-cap для HTML-report | MEDIUM | TASK-164 (depends TASK-141) |
| Skill catch-up (clean / triage / manifest) | MEDIUM | TASK-165 (depends 156, 162, 163) |

## Точка входа

Перед началом задачи — прочитать
[feedback-original.md](feedback-original.md), секцию «Проблемы процесса
создания файлов» (P1–P10) для конкретного P-номера задачи.
