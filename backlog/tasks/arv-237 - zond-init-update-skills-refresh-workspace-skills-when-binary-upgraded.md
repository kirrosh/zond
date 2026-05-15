---
id: ARV-237
title: 'zond init --update-skills: refresh workspace skills when binary upgraded'
status: To Do
assignee: []
created_date: '2026-05-14 11:16'
labels:
  - feedback-loop
  - m-16
  - skill-drift
dependencies: []
priority: medium
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
