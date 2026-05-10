---
id: ARV-48
title: 'fixtures: discover/seed retries network-class errors once with backoff'
status: Done
assignee: []
created_date: '2026-05-10 18:43'
updated_date: '2026-05-10 19:36'
labels:
  - m-17
  - fixtures
  - network
  - agent-contract
milestone: m-17
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14 F2 (medium). Один transient network-flap → contact_id остаётся пустым, дальнейшая cascade-цепочка ломается. Plus сейчас в stdout утекает bun:fetch stack-trace ('The socket connection was closed unexpectedly. ...verbose: true' из аргументов fetch). Без retry user-experience прогона на flaky-сети — рулетка.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 1 retry с 500ms back-off на network-class ошибки (ETIMEDOUT/ECONNRESET/socket-closed/EAI_AGAIN)
- [ ] #2 HTTP-status коды (включая 5xx) retry НЕ получают — это семантика, а не network
- [ ] #3 Stack-trace из bun:fetch не появляется в user-stdout: status таблица содержит 'failed:miss-network: connection failed' без 'verbose:true'
- [ ] #4 Fixture-test: mock unreachable URL → prepare-fixtures выводит status failed:miss-network с retry counter '(retry 1/1)'
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Детектор isNetworkError() в core/runner/send-request.ts — проверка error.code + error.name (NetworkError, AbortError при timeout).\n2. Вынести retry-обёртку (1 attempt, 500ms back-off) в reusable helper — НЕ дублировать с runner-retry из TASK-144.\n3. discover/seed-loop в prepare-fixtures.ts оборачивает вызов через withNetworkRetry().\n4. В status-формате: на miss-network показывать 'failed:miss-network: <short-msg> (retry <n>/<max>)'.
<!-- SECTION:PLAN:END -->
