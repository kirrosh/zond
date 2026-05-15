---
id: ARV-241
title: 'report bundle --include case-study: skill drift (case-study by-default)'
status: Done
assignee: []
created_date: '2026-05-14 11:16'
updated_date: '2026-05-14 11:23'
labels:
  - feedback-loop
  - m-16
  - skill-drift
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F14, class quirk/skill-drift
Repro: zond report bundle 3 -o /tmp/x/ (без --include)
Expected per skill (zond/SKILL.md:434): только report.html + diagnose.json + index.md (минимум).
Actual: case-study.md эмитится по умолчанию — рассогласовано со skill snippet 'bundle <run-id> --include case-study' (как-будто опционально).
Fix: обнови skill (case-study by-default) ИЛИ honor flag.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Skill snippet clarifies that bundle emits all artefacts by default; --include is for subset, not for opting into case-study
<!-- AC:END -->
