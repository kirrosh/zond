---
id: ARV-74
title: 'zond run: YAML load error should print file:line:col, not bare caret'
status: Done
assignee: []
created_date: '2026-05-11 07:05'
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
Source: feedback round 02, finding F15, class ux-papercut (companion to F3/ARV-62, now fixed at the source). Repro: zond run on a YAML with invalid syntax. Expected: '<path>:LINE:COL: bad indentation of a mapping entry'. Actual: parser shows the offending line + caret but no file/line/col header. Log: round-02 raw
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done 2026-05-17 (polish-m-22 batch-2 / error UX): not-a-bug — formatYamlParseError (yaml-parser.ts:38) already prefixes parse errors with 'Invalid YAML in <path>:<line>:<col>:'. Verified live on a malformed YAML; format matches the original ARV-74 expectation.
<!-- SECTION:NOTES:END -->
