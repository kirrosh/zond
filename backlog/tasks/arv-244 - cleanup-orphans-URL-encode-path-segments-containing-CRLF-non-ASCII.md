---
id: ARV-244
title: 'cleanup --orphans: URL-encode path segments containing CRLF/non-ASCII'
status: Done
assignee: []
created_date: '2026-05-15 05:42'
updated_date: '2026-05-15 05:47'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F15, class likely_bug
Repro: после zond probe security crlf на POST /repos/{owner}/{repo}/labels оставляет orphan labels с name='zond-safe\r X-Zond-Injected: yes'. zond cleanup --orphans делает DELETE с literal \r в URL → 404 (серверу нужно %0D в path).
Expected: cleanup должен encodeURIComponent path-segments (включая \r → %0D, \n → %0A) перед DELETE.
Actual: 3 leak'а в kirrotech/test; manual zond request DELETE с percent-encoded slug справился.
Log: ~/Projects/zond-test/.fb-loop/rounds/api-bugs-04.md (cleanup-failures section), security-digest-04.md:9-13
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cleanup --orphans percent-encodes unsafe chars (CRLF, whitespace) in deletePath segments before issuing DELETE
<!-- AC:END -->
