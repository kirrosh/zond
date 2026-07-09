---
id: ARV-388
title: >-
  release: cover full platform matrix (darwin-x64 + linux-arm64) and fix
  installer 404
status: To Do
assignee: []
created_date: '2026-07-09 12:56'
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
- [ ] #1 Release has 5 artifacts: darwin-{arm64,x64}, linux-{x64,arm64}, win-x64
- [ ] #2 install.sh on Intel Mac and linux-arm64 installs a working binary (no 404)
<!-- AC:END -->
