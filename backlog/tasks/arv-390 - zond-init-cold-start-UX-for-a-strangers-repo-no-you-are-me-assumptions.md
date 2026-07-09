---
id: ARV-390
title: zond init cold-start UX for a stranger's repo (no 'you are me' assumptions)
status: Done
assignee: []
created_date: '2026-07-09 12:56'
updated_date: '2026-07-09 13:34'
labels:
  - m-27
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cold-start init assumes author context. Verify the path install → init → doctor → first `audit --safe` under 5 min on an unfamiliar repo. First screen must tell what to fill in .env.yaml and where to go next. Split out from the cold-start tail of old ARV-365.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A stranger reaches a first green `audit --safe` without editing internals or reading source
- [x] #2 init/doctor output points at the exact next action (fill env / run audit)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Walked the stranger path end-to-end (init → add api → doctor → prepare-fixtures → fixtures add → audit --safe) against a live mock. Fixes: (1) audit now accepts --safe as explicit alias of default safe mode (docs/skills/milestone all say 'audit --safe' but the flag didn't exist — stranger's first command died); conflict with --live errors. (2) init next-steps gained step 4 audit --safe; doctor all-set now points at audit instead of dead-ending. (3) Real generator bug found by the walk: serializer whitelist dropped OPTIONS/HEAD/TRACE method keys → probe-methods suites failed self-validation and were skipped ('2 test files skipped due to validation errors' on a stranger's FIRST run); also bare 'json:' (null) for empty {} body. Both fixed + regression tests. Grammar fix in doctor placeholder warning.
<!-- SECTION:NOTES:END -->
