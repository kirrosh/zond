---
id: ARV-106
title: 'report bundle case-study: curl repro missing Authorization header'
status: To Do
assignee: []
created_date: '2026-05-11 08:51'
updated_date: '2026-05-11 08:53'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F12, class likely_bug/ux-papercut
API: sentry

Repro:
  zond report bundle 19 --include case-study -o .fb-loop/rounds/bundle-19/
  grep -A1 '^## Repro' .fb-loop/rounds/bundle-19/19/case-study.md

Expected: either emit 'Authorization: Bearer <REDACTED>' header (zond has redaction registry — <redacted:auth_token> placeholder), OR don't emit curl entirely (anti-curl rule from zond/SKILL.md L154-155: 'NEVER curl or wget') and replace with 'zond request --api <name> POST /api/0/.../keys/ --json ...'.

Actual: curl command without -H 'Authorization: ...'. Copy-paste gets 401, doesn't reproduce the bug. No <REDACTED> placeholder hint either.

Effect: case-study (Phase 7 share-pipeline flagship) looks ready to share but doesn't reproduce the bug without manual editing. The recipient of an issue report doesn't know to add a header.

Log: .fb-loop/rounds/bundle-19/19/case-study.md L17-21
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 case-study curl repro emits an Authorization header line (with redacted placeholder)
- [ ] #2 Skill anti-curl rule respected if --api flag is set
- [ ] #3 Test pins repro contains either Authorization or zond-request alternative
<!-- AC:END -->
