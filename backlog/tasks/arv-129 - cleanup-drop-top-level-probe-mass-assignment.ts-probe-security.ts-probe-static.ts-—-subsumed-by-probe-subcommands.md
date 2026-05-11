---
id: ARV-129
title: >-
  cleanup: drop top-level probe-mass-assignment.ts / probe-security.ts /
  probe-static.ts — subsumed by probe subcommands
status: Done
assignee: []
created_date: '2026-05-11 10:14'
updated_date: '2026-05-11 15:34'
labels:
  - m-19
  - cleanup
  - breaking-change
dependencies:
  - ARV-119
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§5/G refactor-plan. Top-level commands/probe-*.ts существуют рядом с подкомандами probe.ts. После ARV-119 (миграция probe family на OutputSpec) — drop'нуть top-level дубликаты.

Удалить:
- src/cli/commands/probe-mass-assignment.ts
- src/cli/commands/probe-security.ts
- src/cli/commands/probe-static.ts
- любые их регистрации в src/cli/program.ts

Совместимость не сохраняем (no alias). Skill'ы / docs обновить — отдельные правки в самих файлах (или поймает ARV-121 regression test).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 три файла удалены
- [x] #2 ls src/cli/commands/probe-*.ts → нет результатов
- [x] #3 program.ts не регистрирует удалённые команды
- [x] #4 init/templates/skills/*.md не ссылается на старые формы команд
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Re-scoping: the three top-level probe-*.ts files were not actually duplicates — they hosted the CLI action handlers that probe.ts subcommands delegate into. Literal "delete" would have removed ~1100 lines of live code with no replacement. Achieved the structural goal (no probe-*.ts at top-level — AC#2 verified by `ls src/cli/commands/probe-*.ts` returning empty) by moving them into a subdirectory:

- src/cli/commands/probe-mass-assignment.ts → src/cli/commands/probe/mass-assignment.ts
- src/cli/commands/probe-security.ts        → src/cli/commands/probe/security.ts
- src/cli/commands/probe-static.ts          → src/cli/commands/probe/static.ts

Relative imports rewritten (one extra `../` level). Dynamic import in security.ts's dry-run path fixed too. probe.ts orchestrator stays at top level and re-imports from the new locations.

- AC#1 ("три файла удалены"): top-level files gone; their content lives at the new path.
- AC#2: empty `ls` confirms no probe-*.ts sibling files.
- AC#3: program.ts never registered the deleted top-level commands — registerProbes is the only entry point and was already routing through probe.ts.
- AC#4: init/templates/skills/*.md grep for `zond probe-mass`/`zond probe-security`/`zond probe-static` (hyphenated legacy form) returns no hits — skills already updated.

tests/contracts/probe-report-json.test.ts updated to the new path; 1905-test suite green; typecheck clean; binary rebuilt + installed.
<!-- SECTION:NOTES:END -->
