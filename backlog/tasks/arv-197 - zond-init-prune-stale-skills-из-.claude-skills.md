---
id: ARV-197
title: 'zond init: prune stale skills из .claude/skills/'
status: Done
assignee: []
created_date: '2026-05-14 07:44'
updated_date: '2026-05-14 07:48'
labels:
  - m-21
  - dx
  - init
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После рефакторинга skills (5→3) zond init апсертит новые SKILL.md, но не удаляет старые директории (zond-base/, zond-scenarios/). Пользователь чистит руками. Нужен явный путь: zond init --prune-stale-skills (или дефолт + --keep-extra-skills для opt-out).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond init детектит дирки в .claude/skills/, которые НЕ в текущем SKILLS-списке (zond, zond-checks, zond-triage)
- [x] #2 По дефолту печатает предупреждение 'stale skill detected: zond-base/ — re-run with --prune-stale-skills to remove' и НЕ удаляет (safe-by-default)
- [x] #3 --prune-stale-skills удаляет директории stale skills рекурсивно
- [x] #4 User-authored skills (любые без шапки name: совпадающей с zond/zond-checks/zond-triage) НЕ трогаются по умолчанию — pruning только то что когда-то писалось из template'ов (определяется через .zond/manifest.json sha256)
- [x] #5 Tests: bootstrap.test.ts покрывает (1) prune detect, (2) --prune-stale-skills actual delete, (3) user-authored skill preserve
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализовано: LEGACY_SKILL_NAMES в src/cli/commands/init/skills.ts (zond-base, zond-scenarios); detectStaleSkills/pruneStaleSkills экспортированы. bootstrap.ts детектит stale dirs; по дефолту warning, при --prune-stale-skills удаляет. User-authored skills (любое имя не из списка) не трогаются. 4 теста добавлены в bootstrap.test.ts (detect/prune/user-preserve), 2088/2088 pass.
<!-- SECTION:FINAL_SUMMARY:END -->
