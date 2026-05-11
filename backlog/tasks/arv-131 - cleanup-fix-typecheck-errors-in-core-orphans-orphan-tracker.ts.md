---
id: ARV-131
title: 'cleanup: fix typecheck errors in core/orphans/orphan-tracker.ts'
status: To Do
assignee: []
created_date: '2026-05-11 10:14'
labels:
  - m-19
  - cleanup
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§7 refactor-plan. fix-report-03 упомянул pre-existing typecheck errors в orphan-tracker.ts. Цель — `bun run typecheck` зелёный.

Шаги:
1. bun run typecheck → собрать список ошибок в файле
2. Поправить или явно подавить с обоснованием (// @ts-expect-error <reason>)
3. CI поймает регрессию (если CI ещё не падает на этом — добавить typecheck step).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 bun run typecheck — 0 errors
- [ ] #2 tsconfig.json (если был exclude orphan-tracker) приведён в default
- [ ] #3 CI step bun run typecheck присутствует или подтверждено что уже есть
<!-- AC:END -->
