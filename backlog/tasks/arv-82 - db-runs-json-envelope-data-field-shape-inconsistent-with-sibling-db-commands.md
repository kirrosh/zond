---
id: ARV-82
title: >-
  db runs --json envelope: data field shape inconsistent with sibling db
  commands
status: To Do
assignee: []
created_date: '2026-05-11 07:34'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F24, class ux-papercut. Repro: zond db runs --json | jq '.data[].id' → 'Cannot index array with string id'. Suggests .data is not an array (or each item lacks .id). Compare with zond db collections --json which returns an array of objects. Ask: align shape, document, or rename field. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-04.log
<!-- SECTION:DESCRIPTION:END -->
