---
id: TASK-106
title: UI — Suites browser экран (что лежит и что прогонится)
status: To Do
assignee: []
created_date: '2026-04-30 09:37'
labels:
  - trust-loop
  - decision-5
  - ui
dependencies:
  - TASK-100
  - TASK-103
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сценарий «автор сгенерировал тесты через Claude Code, хочет проверить
что нагенерилось ДО прогона» (decision-5 trust loop, persona A).
Сейчас единственный путь — открыть YAML файлы вручную.

## Что добавляется

Новый route `/suites` (третий MVP-экран после `/runs` и `/runs/:id`).

Плоский список всех suite-ов в workspace:

- Колонки: suite name, source.type (openapi-generated / manual), spec
  (если есть), step count, last-run status (если есть), file path.
- Фильтры: source.type, has-failures-in-last-run.
- Click на row → раскрытие с per-step list:
  - test name, source.endpoint + response_branch, request method+url
- В будущем (отдельная задача): кнопка "Run this suite", "Open in
  editor", "Re-generate".

## Зависит

- TASK-100 (provenance в YAML) — без него source-колонка пустая
- TASK-103 (production migration) — экран добавляется в новый src/ui/

## API

- `GET /api/suites` — endpoint, который сканит YAML-файлы в workspace
  (через существующую core/parser/), возвращает список с source-блоками
  и last-run метой (через DB).

## НЕ входит

- Drill-down на отдельный suite-экран (`/suites/:name`) — для MVP
  достаточно expand-row в списке.
- Run trigger из UI — отдельная задача в фазе 2.
- Edit-in-place — отдельная задача (replay-editor spike).

## Тесты

- API endpoint возвращает правильный список с source-блоками
- UI рендерит таблицу и expand работает
- Suite без provenance рендерится как "manual"
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /api/suites возвращает все YAML с source + last-run мета
- [ ] #2 Таблица рендерит, expand-row показывает per-step source
- [ ] #3 Фильтры по source.type работают, has-failures фильтр опционален
<!-- AC:END -->
