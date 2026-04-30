---
id: TASK-113
title: session_id для группировки run'ов из probe-сессии
status: To Do
assignee: []
created_date: '2026-04-30 14:18'
labels:
  - ui
  - db
  - trust-loop
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После `zond init` (а также probe-validation / probe-methods / mass-assignment / hunt) в БД появляется набор разрозненных run'ов, каждый со своим `runs.id`. На странице `/runs` пользователь видит «кучу разных ранов» без понятия, какой из них «итоговый» и где смотреть общую картину после первичной настройки. UX-фидбек: «открываю страницу после первой настройки — там куча ранов и все разные».

## Что сделать

1. БД: добавить колонку `runs.session_id TEXT` (миграция v6→v7). Опциональный, индексируем `(session_id, started_at DESC)`.
2. Запись: probe-команды и `zond init` bootstrap проставляют один и тот же `session_id` (UUID, генерируется в начале флоу) во все вложенные `createRun()`.
3. Чтение: добавить query `listSessions()` — группировка `runs` по `session_id`, агрегаты (total/passed/failed/skipped, suite-команд из metadata).
4. UI: на `/runs` добавить переключатель `Sessions ↔ Runs` либо группировку по сессии. В session-row — раскрытие в список входящих run'ов.
5. Backwards-compat: run'ы без `session_id` показываются как «ad-hoc» отдельной группой.

## Acceptance

- Миграция применяется без потерь.
- После `zond init` все вложенные run'ы привязаны к одной сессии.
- На UI видна одна строка «Init session @ <время>» с агрегатами вместо 5+ отдельных run'ов.
- Старые run'ы продолжают отображаться.

## Связанные

- Parent для UX-проблемы «куча разрозненных ранов после первичной настройки».
- Зависит от probe-команд (текущий вызов `createRun`) — нужно протянуть `sessionId` параметром.
<!-- SECTION:DESCRIPTION:END -->
