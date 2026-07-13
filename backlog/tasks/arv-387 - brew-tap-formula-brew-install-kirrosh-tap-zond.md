---
id: ARV-387
title: brew tap + formula (brew install kirrosh/tap/zond)
status: To Do
assignee: []
created_date: '2026-07-09 12:56'
updated_date: '2026-07-13 10:29'
labels:
  - m-27
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
No brew formula exists. Add a tap (kirrosh/homebrew-tap or Formula in-repo) that downloads the release binary with checksum. Was bundled in old ARV-365.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 brew install kirrosh/tap/zond installs a working zond on a clean macOS
- [ ] #2 formula pins version + sha256, bumpable from the release pipeline
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DEFERRED by user decision (2026-07-09): no tap until first users — trigger event = первые реальные пользователи/спрос на brew. Generator (scripts/release/generate-brew-formula.mjs + tests) and the pipeline bump step stay in the repo; the step self-skips when TAP_GITHUB_TOKEN is absent. README/docs mentions of brew removed until the channel exists. Seed formula draft was prepared in session scratchpad (ephemeral).

rtk-teardown урок #3: homebrew/core (не свой tap) дал rtk органический ~18k/мес tail. Свой tap (эта задача) — слабее. Апгрейд-путь: после первой базы пользователей подать в homebrew/core (планка notability). Пока trigger-gated как было.
<!-- SECTION:NOTES:END -->
