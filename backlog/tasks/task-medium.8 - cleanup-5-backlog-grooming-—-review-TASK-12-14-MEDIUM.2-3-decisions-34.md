---
id: TASK-MEDIUM.8
title: 'cleanup 5: backlog grooming — review TASK-12/14, MEDIUM.2/3, decisions 3+4'
status: Done
assignee: []
created_date: '2026-04-28 12:02'
updated_date: '2026-04-28 12:46'
labels:
  - cleanup
  - backlog
  - grooming
dependencies: []
parent_task_id: TASK-MEDIUM
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Мета-задача: пройтись по бэклогу и закрыть/перезадизайнить устаревшее.

## Scope
1. **TASK-12** (`zond.config.yml` уровневая precedence) — без приоритета, фундаментальный, нужен ли в текущем виде? Решить: добавить priority + acceptance, или архивировать.
2. **TASK-14** (Интерактивный `zond init` через @clack/prompts) — после cleanup-1/2 init упростился до 1 опции. Нужен ли interactive prompt вообще? Решить.
3. **TASK-MEDIUM.2** (`probe-validation --tag` filter не применяется) — empirical-проверка показала, что фильтр работает (case-insensitive после TASK-MEDIUM.4). Закрыть как Done с пометкой, либо переоткрыть с конкретным репро.
4. **TASK-MEDIUM.3** (`probe-validation` 53 probes hit HTTP 405) — investigation-only задача без явного дефекта. Решить: investigate (если кому-то всё ещё интересно) или close as not-a-bug.
5. **decision-3** (web UI) — провести review, выбрать вариант A/B/C, перевести в `accepted`/`rejected`.
6. **decision-4** (postman exporter) — то же.
7. **TASK-19** (`zond/` subdir convention для embed) — пересмотреть в свете current init flow.
8. **TASK-32** (Auto-discovery ID для positive-smoke) — большая фича, нужен ли priority?
9. **TASK-36** (Tagless endpoints fallback) — нужен ли после TASK-MEDIUM.4 (`--list-tags`)?

## Acceptance
- Каждый пункт выше → решение в комментарии задачи (close/keep/reword).
- Бэклог `To Do` уменьшается на N задач, остальные имеют explicit priority и acceptance.
- decision-3 и decision-4 — статус `accepted` или `rejected`.

## Когда делать
После cleanup-1/2/3/4 — чтобы делать groom уже на чистой кодовой базе.
<!-- SECTION:DESCRIPTION:END -->
