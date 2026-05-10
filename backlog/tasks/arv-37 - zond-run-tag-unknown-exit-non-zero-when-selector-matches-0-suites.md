---
id: ARV-37
title: 'zond run --tag <unknown>: exit non-zero when selector matches 0 suites'
status: Done
assignee: []
created_date: '2026-05-10 11:30'
updated_date: '2026-05-10 11:32'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F1, class likely_bug
Repro: zond run apis/resend/tests --api resend --tag does-not-exist → 'Warning: No suites match the specified tags' but exit 0.
Expected: exit 1 (or 2) when --tag selector matches 0 suites; ideally hint with the available tags. Otherwise CI typo (--tag smok) gives a green run with zero coverage.
Actual: silent fail-open. Same shape would also affect --include / --exclude with no matches; verify they share a single empty-set guard.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-10.log:391-392
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond run --tag <unknown> exits with non-zero code (1) when the selector matches 0 suites — was exit 0 with a warning, masking CI typos like --tag smok
- [x] #2 Error message lists the tags actually available among loaded suites so the user can correct without re-reading help
- [x] #3 Same fail-loud behaviour applied to --include/--exclude, --exclude-tag, and --method zero-match branches (consistency)
- [x] #4 Regression test pins the exit code + tag-list hint
- [x] #5 bun run check passes
<!-- AC:END -->
