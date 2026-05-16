---
id: ARV-221
title: 'redactor: do not strip user/org-name in /Users//home/ path segments (R15/F26)'
status: To Do
assignee: []
created_date: '2026-05-14 10:08'
updated_date: '2026-05-16 07:36'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 15, finding F26, class quirk, severity LOW.

Repro: zond probe mass-assignment outputs digest.md where /Users/kirrotech/... becomes /Users/<redacted:org>/... — kirrotech matched the 'organization name' redaction heuristic. Resulting Markdown link is broken.

Expected: redactor must leave path segments under /Users/<name>/ or /home/<name>/ alone — those are local home-dir names, not secrets.

Log: see feedback-15.md F26.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Merged ARV-239 (validation-sprint 2026-05-16): --redact-identity flag должен существовать И не over-strip — один redactor track.
<!-- SECTION:NOTES:END -->
