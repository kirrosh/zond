---
id: TASK-206
title: >-
  tests: split security-probe.test.ts (872 lines) into 3 files + state-machine
  helper
status: To Do
assignee: []
created_date: '2026-05-07 10:12'
labels:
  - refactor
  - tests
  - probe
milestone: m-12
dependencies:
  - TASK-192
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tests/core/probe/security-probe.test.ts: 872 строки, дублирующиеся mock-фабрики (8+ responder-замыканий 'if GET ... if PUT ...'). После TASK-192 (helpers/endpoints) разнести на security-probe-classify, security-probe-restore, security-probe-cleanup-retry; вынести mockResource snapshot helper в tests/core/probe/_helpers/state-machine.ts. putEp/getEp пары для /projects/{id} повторяются 5+ раз — projectPutGetPair фабрика.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tests/core/probe/security-probe-classify.test.ts: detectFields + happy-path runSecurityProbes + formatSecurityDigest + emitSecurityRegressionSuites; <400 строк
- [ ] #2 tests/core/probe/security-probe-restore.test.ts: TASK-151 + TASK-152 describes; <350 строк
- [ ] #3 tests/core/probe/security-probe-cleanup-retry.test.ts: round-4 + round-5 (DELETE 404 retry); <300 строк
- [ ] #4 tests/core/probe/_helpers/state-machine.ts: mockResource({ initial, partialPutOnly?, breakAfter? }) используется в ≥4 тестах
- [ ] #5 Тест-каунт сохранён, зелёное
<!-- AC:END -->
