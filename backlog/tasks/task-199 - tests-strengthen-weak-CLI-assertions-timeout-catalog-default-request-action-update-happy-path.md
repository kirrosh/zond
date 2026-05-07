---
id: TASK-199
title: >-
  tests: strengthen weak CLI assertions (timeout / catalog default / request
  action / update happy-path)
status: Done
assignee: []
created_date: '2026-05-07 10:12'
updated_date: '2026-05-07 12:00'
labels:
  - tests
  - cli
milestone: m-12
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(1) commands.test.ts L98 '--timeout overrides suite config' — assert только code 0; mock instant. Реально не проверяет timeout. Переписать: timeout: 1ms, fetch delay 50ms → expect code 1 + timeout diagnostic. (2) catalog.test.ts L113-125 'defaults output to current directory' — body передаёт явный output, title врёт. Переписать через chdir(tmpDir) + omit output, либо удалить (дубль L38-57). (3) program.test.ts 'collects multiple --header values' — tryParse swallow'ит ошибки action; добавить expect(globalThis.fetch).toHaveBeenCalled(). (4) program.test.ts '--tag accepts comma-separated form' — assert НЕ split'ит, name врёт. Переименовать в '--tag preserves commas (split happens in action)'. (5) update.test.ts: добавить happy-path через инжекцию runtimeKind: outdated→upgrade, up-to-date, --check, network-failure. mockGitHubRelease уже определён, но не используется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 commands.test.ts --timeout: actual timeout срабатывает, expect code 1
- [x] #2 catalog.test.ts: defaults-test переписан или удалён как дубль
- [x] #3 program.test.ts --header test добавляет fetch-have-been-called
- [x] #4 program.test.ts --tag test переименован
- [x] #5 update.test.ts +4 кейса happy-path; mockGitHubRelease используется; updateCommand принимает runtimeKind для test injection
- [x] #6 Зелёное
<!-- AC:END -->
