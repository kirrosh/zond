---
id: ARV-383
title: zond run on a non-existent path reports green 0-test success (false pass)
status: In Progress
assignee: []
created_date: '2026-07-09 11:41'
updated_date: '2026-07-09 11:54'
labels:
  - zond-audit
  - ux
  - run
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by petstore v0.26.0 verify audit (report-zond MF1+UX1).

`zond run <missing-dir>` falls through to the ARV-357 empty-report path: prints a stderr warning but writes `[]` / exit 0, indistinguishable from a real pass for a scripted pipeline. Trigger in the wild: a security probe that matches 0 fields never creates its `probes/security` dir, then the follow-up `zond run <that-dir>` reports 0 tests as success.

Root: parseDirectorySafe globs a non-existent cwd -> empty, no error (src/core/parser/yaml-parser.ts). run.ts:185 then treats 0 suites as advisory exit-0.

Fix: a path that does not exist on disk is a hard error (non-zero); an existing-but-empty dir keeps ARV-357 advisory behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix complete on branch fix/arv-383-run-missing-path (commit 012658a): non-existent path -> exit 2, existing-empty dir keeps ARV-357. Test added, full suite 2446/0, build+install+live-smoke pass. Pending merge to master -> flip to Done on merge.
<!-- SECTION:NOTES:END -->
