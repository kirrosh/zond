---
id: ARV-151
title: >-
  skill drift: SKILL.md examples use 'zond request POST … --json' but real flag
  is --body
status: Done
assignee: []
created_date: '2026-05-12 09:12'
updated_date: '2026-05-12 09:18'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding SD1, class skill-drift/stale-example

Skill: .claude/skills/zond/SKILL.md (Phase 5.1 + general examples)
Severity: high (skill copy-paste yields 'error: unknown option')

What skill says: zond request POST /<path> --json '{...}' --api $API_SLUG
What CLI does: --json is the global envelope-output flag, not a body flag. Real body flag is --body <json>. Skill examples are misleading and cost tester 2 iterations.

Fix: replace --json '<body>' in body-position with --body '<body>' throughout SKILL.md. Keep --json (no value) wherever envelope-output is intended (most current usage is already correct; only the body-passing examples are wrong).

Log: $HANDOFF/rounds/feedback-02.md
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added POST-with-body example to zond.md Phase 5.1 (general 'zond request' section) with explicit note that --body !== --json (envelope flag) + form-encoding caveat pointing at ARV-149. zond-base.md already had correct --body usage. Tester confusion was likely from the lack of a copy-pasteable POST template in the primary skill. Commit dd96756.
<!-- SECTION:NOTES:END -->
