---
id: TASK-109
title: >-
  trust-loop: Coverage map UI с reasons (endpoint × method × status ×
  why-skipped)
status: Done
assignee: []
created_date: '2026-04-30 12:17'
updated_date: '2026-05-03 12:15'
labels:
  - ui
  - trust-loop
  - coverage
milestone: m-6
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Decision-5 явно упоминает в human trust surface: «coverage map с явными причинами пропусков». Сейчас coverage в zond — это число (X из Y endpoints covered) плюс таблица в run-репорте, без причин почему остальное не покрыто.

Хук «zond showed me what I didn't test» — дефенсибельный артефакт доверия и одновременно естественный сюжет для постов («вот то, что Postman не подсветил бы»).

## Что сделать

В zond serve добавить экран Coverage. Матрица:

- Строки: endpoint (path + method).
- Колонки: status_class из OpenAPI (2xx, 4xx, 5xx, default).
- Ячейка: цвет (covered green / partial yellow / uncovered gray / skipped red) + бейдж с причиной для не-зелёных:
  - `no-spec` — этот status_class не описан в OpenAPI.
  - `no-fixtures` — нет path-param fixtures для этого endpoint.
  - `ephemeral-only` — endpoint помечен ephemeral, write-suites выключены в текущем профиле.
  - `auth-scope-mismatch` — текущий API key не покрывает требуемый scope.
  - `tag-filtered` — отфильтровано через --tag.
  - `not-generated` — generator пропустил (deprecated, manual).

Дополнительно:

1. Filter: by tag, by file, by failure_class.
2. Drill-down: клик на ячейку → список конкретных suites/steps, которые покрывают (или объяснение почему нет).
3. Export: сохранить snapshot матрицы как часть HTML-export'a (см. parent-задачу TASK-A).

Источник данных: SQLite + parsed OpenAPI + список suites из workspace. Подсчитываем после run или on-demand при открытии экрана.

## Acceptance

- Экран Coverage в zond serve открывается из навигации.
- Матрица отображает все endpoints из spec.
- Каждая non-covered ячейка имеет explicit reason из перечисленного списка.
- Drill-down показывает конкретные suites или объяснение пропуска.
- Filter по tag/file/failure_class работает.
- Coverage map включается в HTML export (TASK-A).

## Стратегическая ценность

Дефенсибельный артефакт доверия (decision-5). Hook для постов «zond showed me what I didn't test». Делает gap'ы видимыми — пользователь не может игнорировать.
<!-- SECTION:DESCRIPTION:END -->
