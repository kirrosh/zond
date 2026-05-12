---
id: ARV-22
title: >-
  dry-run: chain-local captures mislabeled as fixtures + double 'skipped:'
  prefix
status: Done
assignee: []
created_date: '2026-05-10 07:25'
updated_date: '2026-05-10 07:33'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F3, class definitely_bug + ux-papercut
Repro: zond run apis/resend/tests --tag crud --dry-run → all chained Read/Update/Delete steps emit: '○ Read created topic (skipped: skipped: required fixture {{topic_id}} is empty)'.
Expected: '(skipped: chain capture {{topic_id}} unbound — POST step does not execute under --dry-run)' with single skipped: prefix.
Actual: (a) chain-local var labeled as 'required fixture' (sends user to .env.yaml where the var must NOT live); (b) duplicated 'skipped: skipped:' prefix (looks like a concat bug).
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->
