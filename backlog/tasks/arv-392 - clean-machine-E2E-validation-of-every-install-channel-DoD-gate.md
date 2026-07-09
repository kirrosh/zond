---
id: ARV-392
title: clean-machine E2E validation of every install channel (DoD gate)
status: Done
assignee: []
created_date: '2026-07-09 12:56'
updated_date: '2026-07-09 14:12'
labels:
  - m-27
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prove distribution works for a stranger: fresh container/VM per channel (curl, npm, brew, win) → install → zond init on a public repo → first audit with zero internal knowledge. Record every friction point; friction = channel bug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 curl | sh, npm i -g, brew install, win installer each verified on a clean environment
- [x] #2 Friction log captured and each item filed or fixed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified on clean environments, v0.27.0:
- curl|sh: debian containers linux-x64 + linux-arm64 (docker), ubuntu-latest + macos-latest (CI run 29024304655) — all install and print 0.27.0.
- npm i -g: node:22-slim container WITHOUT bun (postinstall fetched linux-arm64 binary, checksum OK) + ubuntu CI; cold-start init → add api → doctor also walked inside the container.
- win installer: windows-latest runner via install.ps1 → zond.exe --version OK.
- darwin artifacts: checksums verified locally, arm64 native + x64-under-Rosetta both execute.
- brew: excluded from gate (ARV-387 deferred until first users by user decision).
Friction log: ONE new item found and fixed — install.sh/.ps1 resolved the tag via api.github.com and hit unauthenticated rate-limit 403 from shared-IP environments (CI/NAT); switched to releases/latest/download (no API call). Earlier friction (audit --safe missing, serializer OPTIONS/TRACE, init/doctor dead-ends) was found and fixed in ARV-390. Gate is now repeatable: dispatchable workflow .github/workflows/e2e-install.yml.
<!-- SECTION:NOTES:END -->
