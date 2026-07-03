---
id: ARV-216
title: 'probe security: skip-with-reason on GET-only routes (R14/F21)'
status: Done
assignee: []
created_date: '2026-05-14 10:05'
updated_date: '2026-05-16 09:06'
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
Closed as docs-only fix (R16 withdrew the missing-feature finding; targeting works — see security-probe-class.ts:58/71 skip_reason=no-body/no-matched-field).

zond/SKILL.md Phase 7.2 (line 440-471) now documents both targeting filters explicitly: (1) endpoint must have JSON body, (2) ≥1 field name must match the class detectors (SSRF/CRLF/redirect/prompt-injection). Includes operator hint: '0 planned' under narrow --include means GET-only scope, drop --include to see per-endpoint reasons. Added prompt-injection detectors list (was missing).
<!-- SECTION:NOTES:END -->
