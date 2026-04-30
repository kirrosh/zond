---
id: TASK-105
title: UI — failure classification badges + reason tooltips
status: To Do
assignee: []
created_date: '2026-04-30 09:37'
labels:
  - trust-loop
  - decision-5
  - ui
dependencies:
  - TASK-101
  - TASK-103
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После TASK-101 каждое failure несёт failure_class + reason. UI должен
визуализировать классификацию так, чтобы backend за секунду понял
«это реально баг или quirk».

## Что добавляется в Run detail

- В failure card header — colored badge:
  - `definitely_bug` → red (destructive variant)
  - `likely_bug` → amber/warning
  - `quirk` → gray/secondary
  - `env_issue` → blue/outline (уже отдельная категория)
  - `unclassified` → muted (для старых runs без классификации)

- На hover badge — tooltip с failure_class_reason.

- В Runs list: считать только `definitely_bug` + `likely_bug` как
  «настоящие fails» в верхней метрике, `quirk` показывать отдельным
  каунтером (опц.). Это снижает шум на dashboard.

## Где код

- `src/ui/client/src/components/failure-class-badge.tsx` (новый).
- `src/ui/client/src/routes/run-detail.tsx` — рендер бейджа в FailureCard.
- `src/ui/client/src/routes/runs-list.tsx` — опционально, разделение
  counter-ов (TBD; может быть отложено).

## Тесты

- Бейдж рендерится правильным цветом для каждого класса.
- Tooltip с reason показывается на hover.
- unclassified рендерится muted, без crash.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Бейдж по failure_class — корректные variant/цвет, tooltip с reason
- [ ] #2 unclassified рендерится muted без warning
- [ ] #3 Опционально: в Runs list quirk-counter отделён от definitely/likely
<!-- AC:END -->
