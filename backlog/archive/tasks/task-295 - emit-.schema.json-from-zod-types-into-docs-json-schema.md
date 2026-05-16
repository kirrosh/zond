---
id: TASK-295
title: emit *.schema.json from zod types into docs/json-schema/
status: Done
assignee: []
created_date: '2026-05-09 07:00'
updated_date: '2026-05-09 07:59'
labels:
  - json
  - agent-first
  - docs
  - m-13
milestone: m-13
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Тулу нужны JSON-Schema для tool discovery. zod уже описывает структуры — использовать zod-to-json-schema для генерации docs/json-schema/<command>.schema.json. Скрипт в package.json: bun run schemas:emit. Источник: vector-3-agent-first.md §5 quick win #3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Скрипт bun run schemas:emit создаёт docs/json-schema/
- [ ] #2 Schemas покрывают envelope, Issue, SecurityFinding, RunResult, CoverageReport
- [ ] #3 CI проверяет, что schemas в репо актуальны (diff fails)
<!-- AC:END -->
