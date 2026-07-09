---
id: ARV-387
title: brew tap + formula (brew install kirrosh/tap/zond)
status: In Progress
assignee: []
created_date: '2026-07-09 12:56'
updated_date: '2026-07-09 13:42'
labels:
  - m-27
dependencies: []
priority: high
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
Formula generator + release-pipeline bump step are merged on feature/m-27-distribution. BLOCKED on creating the public repo kirrosh/homebrew-tap — auto-mode classifier denied 'gh repo create --public' (needs user approval). Seed content ready in scratchpad (Formula/zond.rb pinned to v0.26.1 darwin-arm64/linux-x64 tar.gz + README). After repo exists: push seed, add TAP_GITHUB_TOKEN secret, then 'brew install kirrosh/tap/zond' is testable on this machine.
<!-- SECTION:NOTES:END -->
