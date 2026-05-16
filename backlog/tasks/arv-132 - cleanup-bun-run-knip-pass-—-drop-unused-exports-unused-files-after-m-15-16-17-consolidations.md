---
id: ARV-132
title: >-
  cleanup: bun run knip pass — drop unused exports / unused files after
  m-15/16/17 consolidations
status: Done
assignee: []
created_date: '2026-05-11 10:14'
updated_date: '2026-05-11 16:49'
labels:
  - m-19
  - cleanup
dependencies:
  - ARV-119
  - ARV-129
  - ARV-130
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§7 refactor-plan. После 50+ ARV-фиксов + консолидаций (m-15/16/17) — knip найдёт мёртвый код. knip.json в repo есть.

Шаги:
1. bun run knip — собрать отчёт
2. Triage по группам:
   - unused exports → drop или mark @internal
   - unused files → drop
   - unused dependencies (package.json) → drop
3. Если knip даст false-positive (динамические require / commander auto-registration) — добавить в knip.json ignore с комментарием.

Лучше делать ПОСЛЕ A/D/G задач — там удалится больше.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 bun run knip — 0 issues
- [x] #2 удалённые файлы / экспорты не используются нигде (двойная проверка grep)
- [x] #3 package.json не содержит unused dependencies
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Initial knip --reporter compact reported 1 unused file + 9 unused exports across src/. Verified each export's usage count inside its own file = 1 (export decl only — fully orphaned, not internal-helper); dropped them outright rather than @internal-marking:

Unused file deleted:
- src/core/anti-fp/rules/coverage-phase-boundary.ts (the schemathesis bundle already registers the rule; this was a placeholder re-export from ARV-126 that nothing imports).

Unused exports dropped:
- src/core/anti-fp/registry.ts: makeSuppression (suppression composition is done inside applyAntiFp directly).
- src/core/checks/stateful.ts: getStatefulCheck + __resetStatefulRegistryForTests.
- src/core/probe/method-shared.ts: missingMethodsForPath.
- src/core/probe/orphan-tracker.ts: fileExists (along with the now-orphan `stat` import).
- src/core/probe/registry.ts: getProbe.
- src/core/probe/types.ts: BaseProbe abstract class.
- src/core/selectors/operation-filter.ts: splitFilterFlags.
- src/db/queries/results.ts: getResultById.
- src/db/queries/collections.ts: getLatestRunForSuite + the orphan LastRunForSuite interface in queries/types.ts.
- src/db/queries.ts: barrel re-exports of the two deleted query helpers trimmed; module-comment updated.

Verified:
- `bun run lint:dead` → 0 issues
- `bunx knip --include dependencies` → 0 issues (AC#3 — no unused production deps in package.json)
- `bun run check` clean
- 1905 tests pass full-suite — no regression from the deletes (the dropped surface had no consumers)
- binary rebuilt and installed
<!-- SECTION:NOTES:END -->
