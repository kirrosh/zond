---
id: TASK-248
title: 'workspace resolve: суммировать или подавить per-var Undefined-warnings когда workspace anchor не найден'
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
labels:
  - feedback-loop
  - api-sentry
  - workspace
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-07#F3 (half-fix in feedback-10).

После фикса при `zond run /tmp/foo.yaml` (вне workspace) появляется один разумный hint:
```
[zond] no workspace marker found from /tmp; using cwd. Run 'zond init' or create zond.config.yml to anchor the workspace.
```
Это улучшение. Но дальше ВСЁ ЕЩЁ идут per-var warnings:
```
Undefined variable {{base_url}} in probe-body
Undefined variable {{auth_token}} in probe-body
... ×8-12 per test
```

Expected: после первого summary-hint'а per-var spam подавляется (или сворачивается в `... and 11 more`). Альтернатива — single line `Undefined: base_url, auth_token, ... (workspace not anchored)`.

Actual: 8-12 предупреждений на тест, шум.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Когда workspace marker не найден И .env.yaml не загружен — per-var warnings сворачиваются в один line с агрегированным списком.
- [ ] Verify: `zond run /tmp/_outside.yaml` → 1 summary-hint + 1 aggregated `Undefined: ...` line, не 8-12.
<!-- SECTION:ACCEPTANCE:END -->
