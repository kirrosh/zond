---
id: ARV-220
title: 'pagination_invariants: support type=page (currently cursor-only) (R15/F24)'
status: To Do
assignee: []
created_date: '2026-05-14 10:08'
labels:
  - feedback-loop
  - api-github
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 15, finding F24, class missing-feature, severity MEDIUM.

Repro:
  # after annotate apply --pagination type=page limit_param=per_page for tasks
  zond checks run --api github --check pagination_invariants --include 'path:^/agents/tasks' --report ndjson
  # → skipped_outcomes: "pagination_invariants: pagination type 'page' not implemented yet — cursor-style only in this milestone" ×1

Expected: skill says 'pagination.type: cursor | page | offset | token' are all supported. type=page is the most common shape (GitHub, GitLab, Atlassian, Notion, Linear) — limited cursor-only support makes m-20 effectively dark on REST APIs.

Actual: silent skip with milestone-cap reason.

Fix: extend pagination_invariants check to support type=page (page_param=page, limit_param=per_page) — at least invariants like 'page N+1 different items from page N', 'page beyond total returns empty', 'per_page=N returns ≤N items'.

Or, until implemented, the annotate-apply validator should warn 'type=page not yet supported — only cursor works in this milestone'.

Log: see feedback-15.md F24.
<!-- SECTION:DESCRIPTION:END -->
