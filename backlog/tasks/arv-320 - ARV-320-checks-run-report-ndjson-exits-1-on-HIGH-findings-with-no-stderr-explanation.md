---
id: ARV-320
title: >-
  ARV-320: checks run --report ndjson exits 1 on HIGH findings with no stderr
  explanation
status: Done
assignee: []
created_date: '2026-07-02 16:41'
updated_date: '2026-07-02 16:41'
labels:
  - exit-code
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on the 2026-07-02 19:10 clean Stripe re-run (report-zond UX papercut #1, mistakenly framed as 'clean run' -- there was a real HIGH finding so exit 1 was correct, but silent). Root cause: the 'N HIGH/CRITICAL finding(s) -- exiting with code 1' stderr tail was gated on '!ndjson', with a stale comment claiming 'stderr already carried the summary just above' -- true for console/json mode (human summary printed just above), false for ndjson mode (separate code branch whose only stderr line is 'NDJSON report written to <path>'). Under --report ndjson + set -e in CI, exit 1 looked unexplained. Fix: always write the reason to stderr regardless of --report format -- it's stderr, not stdout, so ndjson's stdout-discipline is untouched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 checks run --report ndjson with a HIGH finding writes 'N HIGH/CRITICAL finding(s) -- exiting with code 1' to stderr
- [ ] #2 --advisory still explains the count but exits 0
- [ ] #3 regression test covers both cases end-to-end via the CLI
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed the '&& !ndjson' guard in checks.ts around the exit-code stderr explanation. Test: ndjson-high-exit-explained.test.ts (2/2 — default exit 1 + advisory exit 0, both explained on stderr).
<!-- SECTION:NOTES:END -->
