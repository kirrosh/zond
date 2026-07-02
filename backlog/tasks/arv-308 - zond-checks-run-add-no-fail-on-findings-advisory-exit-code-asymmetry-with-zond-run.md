---
id: ARV-308
title: >-
  zond checks run: add --no-fail-on-findings / --advisory (exit-code asymmetry
  with zond run)
status: Done
assignee: []
created_date: '2026-07-02 11:09'
updated_date: '2026-07-02 11:35'
labels:
  - zond-side
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
zond checks run exits 1 on any finding with no advertised suppress flag, so an orchestrator (workflow/CI) cannot distinguish 'found drift' from 'command failed' without parsing ndjson. zond run already advertises --no-fail-on-failures in its exit-1 message; checks run should mirror it. Repro: zond checks run --api github → exit 1 with findings, no --advisory path. Found via zond-audit github authed run 20260702-133655 (report-zond Z2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 add --no-fail-on-findings (or --advisory alias) to checks run: exit 0 when the command completed and findings exist
- [ ] #2 mention the flag in the exit-1 summary line, mirroring zond run
<!-- AC:END -->
