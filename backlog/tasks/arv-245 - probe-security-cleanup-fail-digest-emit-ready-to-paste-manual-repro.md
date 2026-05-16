---
id: ARV-245
title: 'probe security cleanup-fail digest: emit ready-to-paste manual repro'
status: Done
assignee: []
created_date: '2026-05-15 05:42'
updated_date: '2026-05-15 05:47'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F16, class ux-papercut
Repro: digest показывает 'persisted across retries — likely real leak | DELETE /repos/{owner}/{repo}/labels/{label_name} → 404 (id=10950897260)'. id здесь internal numeric, бесполезен для DELETE (label DELETE по slug, не id).
Expected: 'Suggested manual cleanup: zond request DELETE /repos/kirrotech/test/labels/<percent-encoded-slug> (note: contains \r\n)' — готовая строка к копипасту.
Actual: только id=N.
Log: ~/Projects/zond-test/.fb-loop/rounds/api-bugs-04.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 security digest Cleanup-failures section emits 'Manual repro: zond request DELETE …' with percent-encoded path for each cleanup-fail with a deletePath
<!-- AC:END -->
