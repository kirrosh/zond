---
id: ARV-16
title: doctor and coverage suggest different next-steps for same blocker
status: Done
assignee: []
created_date: '2026-05-10 07:13'
updated_date: '2026-05-10 07:58'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F3, class ux-papercut
Repro: zond doctor --api resend → 'edit apis/resend/.env.yaml and fill 12 required values'. zond coverage → 'run zond discover --api resend or seed manually'.
Expected: один консистентный путь. Либо doctor тоже упоминает zond discover, либо coverage не рекламирует discover'а если doctor его игнорирует.
Actual: два разных правильных следующих шага в зависимости от утилиты.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->
