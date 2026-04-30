---
id: TASK-61
title: 'T61: State-machine probe для enum-статусов'
status: To Do
assignee: []
created_date: '2026-04-29 08:34'
labels:
  - bug-hunting
milestone: m-5
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Если в OpenAPI у ресурса есть поле `status: { enum: [draft, scheduled, sent] }` — у него подразумеваемый автомат переходов. Документация почти всегда отстаёт от реального поведения (напр. DELETE на sent broadcast возвращает 200 вместо 404, cancel на draft → 500).

Round 2: автомат для broadcasts не запустить без verified domain (упирается в 422 на send), но класс probe валиден для других ресурсов / других API.

## Что сделать

Команда `zond probe-state-machine <spec>`:

1. Найти в spec ресурсы со статус-полем (enum по имени status/state/phase).
2. Сгенерировать сьют:
   - Create → проверить начальный статус против ожидаемого (если в spec указан default).
   - Для каждой пары (статус, action) попытаться выполнить action и зафиксировать результат: 2xx / 4xx / 5xx + следующий статус.
   - Построить наблюдаемую матрицу переходов.
3. Если в spec есть документированная state-machine (через x-state-machine extension или explicitly разрешённые actions через 4xx examples) — diff'нуть.
4. Findings: 5xx на любом переходе → bug; 2xx на переходе помеченном invalid в доках → drift; 4xx на переходе помеченном valid → drift в обратную сторону.

## Acceptance

- На spec с status-полем строит матрицу и markdown-отчёт.
- 5xx-переходы помечены как bug-candidates.
- Опциональная зависимость от setup-фикстуры (cross-suite captures, T65) для случаев когда нужны pre-existing ресурсы.
<!-- SECTION:DESCRIPTION:END -->
