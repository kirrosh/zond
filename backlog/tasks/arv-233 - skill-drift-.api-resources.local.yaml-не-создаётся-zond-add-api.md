---
id: ARV-233
title: 'skill drift: .api-resources.local.yaml не создаётся zond add api'
status: Done
assignee: []
created_date: '2026-05-14 10:41'
updated_date: '2026-05-14 10:43'
labels:
  - feedback-loop
  - m-16
  - skill-drift
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding SD3, class skill-drift gap
Repro: zond add api github; ls apis/github/.api-resources.local.yaml → no such file
Expected: skill SKILL.md:73,111,319-321 описывает .api-resources.local.yaml как overlay (extensions + annotate output, hand-edit OK) — подразумевается что файл есть после add.
Actual: появляется только после annotate apply --yes; до этого 'hand-edit OK' формулировка вводит в заблуждение.
Fix options: (a) обновить skill: 'появляется после первого annotate apply'; (b) zond add api создаёт пустой шаблон с комментариями.
Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Skill template clarifies that .api-resources.local.yaml appears after first annotate apply (or hand-created)
<!-- AC:END -->
