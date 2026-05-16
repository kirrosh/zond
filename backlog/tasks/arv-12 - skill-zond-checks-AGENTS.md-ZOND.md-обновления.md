---
id: ARV-12
title: 'skill: zond-checks + AGENTS.md / ZOND.md обновления'
status: Done
assignee: []
created_date: '2026-05-09 15:48'
updated_date: '2026-05-09 18:19'
labels:
  - skill
  - m-15
  - depth
  - docs
  - agent
milestone: m-15
dependencies:
  - ARV-2
  - ARV-3
  - ARV-4
  - ARV-5
  - ARV-11
priority: medium
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 skill zond-checks.md в init-template, проходит embed-тесты
- [x] #2 AGENTS.md содержит раздел Depth checks с work examples
- [x] #3 ZOND.md обновлён по всем новым флагам/командам m-15
- [x] #4 README updated table reflects checks/SARIF/workers
- [ ] #5 Vibe-test через /zond-fb-tester: агент запускает zond checks run без подсказок на mock API
- [ ] #6 Vibe-test: агент использует recommended_action для классификации finding-а
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Новый skill `src/cli/commands/init/templates/skills/zond-checks.md` (~150 строк): когда вызывать, как читать findings, как использовать recommended_action для триажа.
2. Обновить AGENTS.md: добавить раздел "Depth checks" с примерами `zond checks run`, `zond checks list`, `--report sarif`, `--workers`.
3. Обновить ZOND.md (CLI reference): новая секция checks + coverage phase + filtering + workers + ndjson.
4. Обновить README.md table "Key Capabilities": добавить SARIF + checks + concurrent workers.
<!-- SECTION:PLAN:END -->
