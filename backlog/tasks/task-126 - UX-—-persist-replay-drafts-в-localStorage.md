---
id: TASK-126
title: UX — persist replay drafts в localStorage
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
  - replay
milestone: m-7
dependencies: []
priority: medium
---

## Description

Replay draft (изменённые method/url/headers/body + history) живёт в `useState`, теряется при F5 / переходе на другой run. Для итеративной отладки — больно. Сохранять draft в localStorage по ключу `zond:replay:<resultId>`, восстанавливать при открытии того же step'а.

## Acceptance Criteria

- [ ] Draft автосохраняется в localStorage debounced 500ms
- [ ] При открытии replay-tab восстанавливается из localStorage если есть; иначе — из `initFromStep(step)`
- [ ] Кнопка `Reset to original` рядом с `Save as YAML` — сбрасывает к initial draft и чистит storage
- [ ] History (последние 20 ответов) тоже сохраняется
- [ ] Storage TTL — 7 дней; старее — игнорируется и чистится при загрузке
