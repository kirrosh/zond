---
id: TASK-219
title: >-
  zond generate: support --force/--overwrite flag to regenerate over existing
  tests
status: To Do
assignee: []
created_date: '2026-05-07 14:53'
updated_date: '2026-05-07 15:29'
labels:
  - feedback-loop
  - api-resend
dependencies: []
milestone: m-14
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03 (verify), finding FV1, class ux-papercut. Repro: zond generate ... --force -> error: unknown option '--force'; --overwrite same. Expected: flag for forced regeneration over existing files (currently must rm -rf tests/). Actual: without flag generate skips existing files (manifest), no explicit way to regenerate except removing tests/ dir. Log: /tmp/zond-fb/resend/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Analysis (round 04 fixer session): generate already overwrites unconditionally via Bun.write without an exists-check (src/cli/commands/generate.ts:159). The user's claim that 'generate skips existing files due to manifest' is inaccurate — manifest only records sha hashes, never blocks writes. Real --force semantics would be 'overwrite even manifest-tracked user-edited files', requiring a sha mismatch check first. That's a real feature, not a no-op flag — keep deferred until designed properly. Quick mitigation: clarify in --help that generate overwrites.
<!-- SECTION:NOTES:END -->
