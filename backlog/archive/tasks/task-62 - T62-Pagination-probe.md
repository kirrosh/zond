---
id: TASK-62
title: 'T62: Pagination probe'
status: To Do
assignee: []
created_date: '2026-04-29 08:35'
labels:
  - bug-hunting
milestone: m-5
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Round 2 нашёл два пагинационных бага руками: B8 (`limit=1.5` → 500 — float coercion) и B11 (`limit=999999` → has_more отсутствует в ответе). Класс ловится систематически отдельной пробой.

## Что сделать

Команда `zond probe-pagination <spec>` (или флаг к probe-validation):

Для каждого list-эндпоинта (POST/GET с массивом в response):
1. Boundary-проверки на limit/page/offset/per_page:
   - `limit=-1`, `limit=0`, `limit=999999`, `limit=abc`, `limit=1.5`, `limit=null`, `limit=` (empty).
   - Аналогично для offset/page.
2. Cursor-инварианты:
   - `?after=' OR 1=1--` → не должно быть SQL-injection (200 пустой data ок, 500 — bug).
   - `?after=<cursor с прошлой страницы N>` на endpoint M → ожидание 4xx invalid cursor.
3. Schema-инварианты (требует T57 response-validation):
   - has_more: required → присутствует на всех вариантах limit.
   - has_more=false → следующая страница пустая (follow-up call с next cursor).
   - Одинаковые id на разных страницах → bug сортировки.
4. Output — failures с classification (5xx-bug / contract-drift / sql-leak).

## Acceptance

- Ловит B8 (limit=1.5 → 500) и B11 (has_more отсутствует).
- Опционально проверяет has_more=false invariant через follow-up.
- Документация.

## Связь

T57 (response-schema) — для invariant has_more required.
<!-- SECTION:DESCRIPTION:END -->
