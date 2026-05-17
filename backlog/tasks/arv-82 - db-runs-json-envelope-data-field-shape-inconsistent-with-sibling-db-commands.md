---
id: ARV-82
title: >-
  db runs --json envelope: data field shape inconsistent with sibling db
  commands
status: Done
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-17 05:44'
labels:
  - feedback-loop
  - api-resend
  - m-16
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F24, class ux-papercut. Repro: zond db runs --json | jq '.data[].id' → 'Cannot index array with string id'. Suggests .data is not an array (or each item lacks .id). Compare with zond db collections --json which returns an array of objects. Ask: align shape, document, or rename field. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-04.log
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-17 (polish-m-22 batch-2 / envelope): not-a-bug — db runs and db collections both wrap under data.<plural>. Documented the envelope shape (incl. ARV-240 jq path) in zond.md Diagnose-failures section so the next agent doesn't mis-jq.
<!-- SECTION:NOTES:END -->
