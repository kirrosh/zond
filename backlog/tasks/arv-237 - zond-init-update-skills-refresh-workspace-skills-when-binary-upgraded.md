---
id: ARV-237
title: 'zond init --update-skills: refresh workspace skills when binary upgraded'
status: Done
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-16 08:15'
labels:
  - feedback-loop
  - m-16
  - skill-drift
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F10/SD7, class missing-feature
Repro: бинарь обновлён (новый mtime), .claude/skills/zond/SKILL.md в workspace остаётся старым. Tester после fixer'а работает на устаревших skill'ах.
Expected: zond init должен сравнить хэши skill-источников в бинаре с workspace и предложить update (или авто-update с backup'ом). Или zond doctor показывает 'skills outdated, run zond init' при расхождении хэшей.
Actual: zond init не пере-копирует skill'ы (run-once); workspace skill copy diverges от бинаря по мере фиксов.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-03.log
Корневая причина для SD7 (.api-resources.local.yaml lifecycle): fix в ARV-233 не дошёл до workspace потому что zond init не пере-копирует.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: option 1 (zond doctor staleness warning).

Added detectSkillDrift(cwd) to src/cli/commands/init/skills.ts — compares each in-binary skill body against .claude/skills/<name>/SKILL.md, returns fresh|outdated|missing per template.

Wired into src/cli/commands/doctor.ts: after the staleArtifacts/fixture-manifest checks, doctor walks detectSkillDrift and pushes 'workspace skills outdated (X, Y) — run zond init to refresh .claude/skills/' into report.warnings when any skill is outdated. Missing is silent (user may have --no-skills'd intentionally).

Test: tests/cli/init/bootstrap.test.ts adds 'ARV-237: detectSkillDrift reports missing/outdated/fresh' covering all three states.

Verified manually in /tmp/zond237 — corrupting SKILL.md surfaces the warning under data.warnings; zond init clears it. Existing 22 tests in doctor/init still green.
<!-- SECTION:NOTES:END -->
