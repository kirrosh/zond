---
id: ARV-203
title: >-
  CLI: fatal errors lose stack/context — add --debug/ZOND_DEBUG=1 trace hint
  (R10/F4)
status: To Do
assignee: []
created_date: '2026-05-14 08:11'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F4, class ux-papercut, severity LOW.

Repro:
  zond generate --api github --output /tmp/x  # → 'Error: undefined is not an object...' (single line)
  zond prepare-fixtures --api github           # → same one-line error

Expected: either a stack trace (gated by ZOND_DEBUG=1 / --debug), or an inline hint 'for full trace: --debug | --log-file'. Currently TypeError fatals lose all data about which endpoint/parameter triggered them — had to jq the spec manually to locate x-circular.

Actual: one bare error line, no hints.

Log: any failing zond generate/prepare-fixtures call.
<!-- SECTION:DESCRIPTION:END -->
