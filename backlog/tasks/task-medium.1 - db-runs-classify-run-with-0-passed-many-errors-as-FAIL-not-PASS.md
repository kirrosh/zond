---
id: TASK-MEDIUM.1
title: 'db runs: classify run with 0 passed / many errors as FAIL not PASS'
status: To Do
assignee: []
created_date: '2026-04-28 07:22'
labels:
  - bug-hunting
  - from-iteration-2
dependencies: []
parent_task_id: TASK-MEDIUM
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context: 'zond db runs --limit 5' currently reports e.g. '#43 PASS 0/604 passed' for a run where every step errored with 'base_url is not configured'. Observation (iteration-2 APPLY): the misleading PASS made it easy to overlook a totally broken run. Status appears to be computed from failed>0 only, ignoring error>0. Suggested fix: in the run-listing formatter (likely src/cli/commands/db.ts or a renderer), treat a run with passed==0 and (failed+error)>0 as FAIL (or introduce ERROR state). Bonus: include error count in the line, e.g. '#43 FAIL 0p/0f/604e'. Same logic should propagate to JUnit/JSON reporters if they share the field.
<!-- SECTION:DESCRIPTION:END -->
