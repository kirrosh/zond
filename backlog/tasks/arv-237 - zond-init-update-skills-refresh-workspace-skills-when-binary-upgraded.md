---
id: ARV-237
title: 'zond init --update-skills: refresh workspace skills when binary upgraded'
status: To Do
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-16 08:11'
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
Discovery: upsertSkills() in src/cli/commands/init/skills.ts ALREADY does hash-aware drift detection — it overwrites .claude/skills/<name>/SKILL.md when body differs from in-binary template, noop when equal. Re-running 'zond init' (no args) in a workspace already refreshes skills.

Actual gap is *discoverability*: nothing prompts the user (or feedback-loop bot) to re-run zond init after binary upgrade. Two options:
1. (smaller) zond doctor: add skill-staleness comparison — when .claude/skills/<name>/SKILL.md hash != in-binary template, emit warning 'workspace skills outdated, run zond init'. ~30 LOC in src/cli/commands/doctor.ts + skills.ts (export computeSkillDrift).
2. (bigger) zond init --update-skills explicit subcommand flag that skips zond.config.yml / AGENTS.md / apis/ checks and only runs upsertSkills with a verbose diff. Useful for CI / loop bots.

Recommend option 1 first — it surfaces the problem; user runs zond init to fix. Add --update-skills only if option 1 is insufficient in practice.
<!-- SECTION:NOTES:END -->
