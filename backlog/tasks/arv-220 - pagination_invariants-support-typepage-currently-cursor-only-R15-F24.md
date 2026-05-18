---
id: ARV-220
title: 'pagination_invariants: support type=page (currently cursor-only) (R15/F24)'
status: Done
assignee: []
created_date: '2026-05-14 10:08'
updated_date: '2026-05-16 08:58'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented page-style support in pagination_invariants (m-21).

Added: PaginationConfig.pageParam + startPage, yaml fields page_param/start_page (discover.ts, checks.ts, resources-builder.ts), annotate skill schema + EXPECTED_OUTPUT_SHAPE (pagination.ts).

Check logic split into runCursorStyle/runPageStyle (pagination_invariants.ts). Page-style invariants:
- duplicate_items: A∩B disjoint by cursor_field (same data-loss signal as cursor)
- per_page_exceeded: server cannot return > per_page items on either page
- empty page B = natural end-of-list (pass, not skip)
has_more NOT enforced for page-style (most APIs use Link headers / total_pages).

Auto-detect: `page` / `page_number` / `pagenumber` query params trigger page-style when no yaml. Defaults: page_param=page, start_page=1, limit_param=per_page, default_limit=2.

offset/token still short-circuit with 'not implemented'.

Tests: 7 new page-style cases (pagination-invariants.test.ts) — disjoint pass, duplicates fail, per_page exceeded, empty B = pass, start_page=0, auto-detect, custom params. All 17 tests green; 2198/2198 unit tests pass.

Skill template (zond-checks.md): updated heads-up + page-style yaml example.
<!-- SECTION:NOTES:END -->
