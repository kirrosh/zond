---
id: ARV-216
title: 'probe security: skip-with-reason on GET-only routes (R14/F21)'
status: To Do
assignee: []
created_date: '2026-05-14 10:05'
updated_date: '2026-05-16 07:35'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 14, finding F21, class ux-papercut / missing-feature, severity MEDIUM.

Repro:
  zond probe security --api github ssrf,crlf,open-redirect --dry-run \
    --include 'path:^/(meta|search/repositories)$'
  # → Plan: 0 planned · 0 skipped · 0 total

Expected: skipped > 0 with per-op reasons like 'GET-only route — security probes need a request body' or 'no vulnerable field name detected'. Tester should be able to see why 0 ops were planned.

Actual: '0 / 0 / 0' makes it look like the --include filter is broken, not that the probe family doesn't target read-only routes.

Skill .claude/skills/zond/SKILL.md Phase 7 doesn't mention this targeting constraint either — needs a parallel doc update.

Log: see feedback-14.md F21.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
round-16 F21 withdrawn by tester — was artifact of narrow --include (GET-only routes); with broader scope (no --include) probe security shows clear skip reasons 'no-body', 'no-matched-field'. Skill drift SD16 still valid (Phase 7 docs don't mention vulnerable-field+body criterion). Reclassify to LOW skill-update.
<!-- SECTION:NOTES:END -->
