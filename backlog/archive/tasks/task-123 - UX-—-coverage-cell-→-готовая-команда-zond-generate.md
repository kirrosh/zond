---
id: TASK-123
title: UX — coverage cell → готовая команда zond generate
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
  - coverage
milestone: m-7
dependencies: []
priority: high
---

## Description

Сейчас в coverage drilldown видны причины, почему ячейка не покрыта (`not-generated`, `no-fixtures`, и т.д.). Логичное продолжение — сразу дать пользователю готовую CLI-команду, которая закроет gap, с copy-кнопкой.

## Acceptance Criteria

- [ ] В drilldown под reasons добавлен блок `Quick fix` с готовой командой
- [ ] `not-generated` → `zond generate --api <name> --endpoint <method> <path>`
- [ ] `no-fixtures` → подсказка какие env vars дописать в `.env.yaml` + готовый snippet
- [ ] `auth-scope-mismatch` → подсказка про security scheme + env var
- [ ] `tag-filtered` → команда снять или изменить tag-filter
- [ ] Copy-кнопка на каждой команде
- [ ] Если несколько reasons — несколько quick-fix блоков
