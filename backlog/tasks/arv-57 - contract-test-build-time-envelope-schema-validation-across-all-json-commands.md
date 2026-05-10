---
id: ARV-57
title: >-
  contract-test: build-time envelope schema validation across all --json
  commands
status: Done
assignee: []
created_date: '2026-05-10 18:45'
updated_date: '2026-05-10 20:22'
labels:
  - m-17
  - contract-test
  - ci
  - agent-contract
milestone: m-17
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-184 codified --json envelope policy в один модуль, но это convention — probe-команды его уже нарушают (feedback-15 F3). Нужен build-time контракт: для каждой команды с --json есть docs/json-schema/<cmd>.schema.json, и snapshot envelope из smoke-run валидируется против неё. Tests fail в CI если новая команда без schema или нарушает schema. TASK-184 envelope становится контрактом, не соглашением.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tests/contracts/envelope-compliance.test.ts: для каждой команды с --json в src/cli/commands/ есть smoke-run на mock fixture; envelope валидируется ajv по docs/json-schema/<cmd>.schema.json
- [x] #2 Команда без schema файла → test fail с понятным сообщением 'add docs/json-schema/<cmd>.schema.json or document why command does not implement envelope'
- [x] #3 Команда с envelope нарушающим schema → test fail с ajv error path
- [x] #4 Покрытие >= 80% --json команд (некоторые могут быть deferred с allow-list, но allow-list виден в коде)
- [x] #5 После ARV-50/51 probe-команды попадают в test и проходят
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. tests/contracts/envelope-compliance.test.ts: enumerate cli/commands/ at test-time, для каждой команды с --json — smoke-run на fixture spec.\n2. Сравнение с docs/json-schema/<cmd>.schema.json через ajv.\n3. Allow-list для команд с justified omission (с TODO-комментом).\n4. Добавить генерацию docs/json-schema/ при build (TASK-295 already does this — переиспользовать).
<!-- SECTION:PLAN:END -->
