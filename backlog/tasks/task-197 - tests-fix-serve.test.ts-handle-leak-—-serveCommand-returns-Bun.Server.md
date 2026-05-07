---
id: TASK-197
title: 'tests: fix serve.test.ts handle leak — serveCommand returns Bun.Server'
status: To Do
assignee: []
created_date: '2026-05-07 10:10'
labels:
  - refactor
  - tests
  - cli
milestone: m-12
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tests/cli/serve.test.ts L29-42 и L44-62 запускают реальный Bun.serve через serveCommand(...) но не получают handle — комментарий L37-41 признаёт leak. Server утекает до exit процесса. Также pickFreePort() рандом → flake. Решение: serveCommand (или sibling) возвращает { code, server? } чтобы тесты звали server.stop(true). Заменить pickFreePort на retry-pickAvailablePort (или экспортировать существующий из server.ts).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/cli/commands/serve.ts: serveCommand возвращает { code, server } или есть serveCommandWithHandle, не ломая существующий CLI-контракт
- [ ] #2 tests/cli/serve.test.ts: оба happy-path теста регистрируют server.stop в stopAll
- [ ] #3 Замена pickFreePort на pickAvailablePort с retry (или экспорт уже существующего хелпера из server.ts)
- [ ] #4 Прогон tests/cli/serve.test.ts дважды подряд без 'address in use'
<!-- AC:END -->
