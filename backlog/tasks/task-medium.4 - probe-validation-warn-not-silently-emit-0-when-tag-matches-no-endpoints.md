---
id: TASK-MEDIUM.4
title: 'probe-validation: warn (not silently emit 0) when --tag matches no endpoints'
status: In Progress
assignee: []
created_date: '2026-04-28 08:15'
updated_date: '2026-04-28 10:16'
labels:
  - bug-hunting
  - from-iteration-3
dependencies: []
parent_task_id: TASK-MEDIUM
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Context: APPLY iter-3 ran 'probe-validation … --tag Audiences --max-per-endpoint 8'. The OpenAPI literally contains "Audiences" as a tag, but the command output 'Generated 0 probe suite(s)'. No warning, no list of available tags. APPLY agent had to drop the filter to get any output. Related to TASK-MEDIUM.2 (tag filter not applied). Concrete asks: (1) when --tag X matches 0 ops, exit non-zero with stderr 'no endpoints tagged X — available tags: [...]'; (2) add --list-tags subflag that just prints the tag set from the spec; (3) normalize tag matching to case-insensitive trimmed compare.
<!-- SECTION:DESCRIPTION:END -->
