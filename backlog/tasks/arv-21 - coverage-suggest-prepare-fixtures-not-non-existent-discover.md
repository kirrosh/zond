---
id: ARV-21
title: 'coverage: suggest ''prepare-fixtures'', not non-existent ''discover'''
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
Source: feedback round 03, finding F2, class likely_bug
Repro: zond coverage on un-seeded suite prints: 'run zond discover --api <name> or seed manually'. zond discover does not exist (replaced by prepare-fixtures per its own docstring).
Expected: prompt to call zond prepare-fixtures --api <name> [--cascade --seed].
Actual: user follows the suggestion, gets global help with no error, loses time.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->
