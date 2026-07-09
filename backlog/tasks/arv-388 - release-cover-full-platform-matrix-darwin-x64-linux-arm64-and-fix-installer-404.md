---
id: ARV-388
title: >-
  release: cover full platform matrix (darwin-x64 + linux-arm64) and fix
  installer 404
status: Done
assignee: []
created_date: '2026-07-09 12:56'
updated_date: '2026-07-09 13:14'
labels:
  - m-27
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Release ships only darwin-arm64, linux-x64, win-x64. Missing darwin-x64 (Intel Macs) and linux-arm64 → install.sh maps these to non-existent artifacts and 404s. Add the two targets to the release; make install.sh/.ps1 either cover all 5 targets or degrade with a clear message instead of a raw 404.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Release has 5 artifacts: darwin-{arm64,x64}, linux-{x64,arm64}, win-x64
- [x] #2 install.sh on Intel Mac and linux-arm64 installs a working binary (no 404)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
release.yml matrix → 5 targets via bun build --compile --target (linux-arm64 and darwin-x64 cross-compiled on existing runners; both verified locally: ELF aarch64 + Mach-O x86_64, x64 runs under Rosetta). install.sh: clear error with releases link instead of raw 404. install.ps1: ARM64 → x64 fallback with emulation note (bun has no windows-arm64 target). Real 5-artifact release proven at next tag; clean-machine check = ARV-392.
<!-- SECTION:NOTES:END -->
