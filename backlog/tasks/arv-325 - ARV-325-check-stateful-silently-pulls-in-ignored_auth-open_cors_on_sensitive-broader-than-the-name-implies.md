---
id: ARV-325
title: >-
  ARV-325: --check stateful silently pulls in
  ignored_auth/open_cors_on_sensitive, broader than the name implies
status: To Do
assignee: []
created_date: '2026-07-03 07:42'
updated_date: '2026-07-03 15:53'
labels:
  - checks
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260703-100734 (raw/40-stateful.ndjson). 'zond checks run --api stripe --check stateful --include method:GET ...' -- jq -r 'select(.type==check_result)|.check' | sort | uniq -c shows cursor_boundary_fuzzing (100), pagination_invariants (45), ensure_resource_availability (8), cross_call_references (5) -- genuinely stateful -- but also ignored_auth (262) and open_cors_on_sensitive (261), which are auth/security checks, not stateful. Cost: a run expected to cover ~158 genuinely-stateful checks on 262 read-only ops instead ran the full security pair too, ~10 minutes instead of the expected sub-minute (first attempt was killed by the caller's own SIGTERM at 5 minutes before this was understood). Either --check stateful is an intentionally broader category alias (in which case document it, e.g. in --check <ids...> --help and skill docs) or there's a bug in the checks-to-category mapping that should exclude ignored_auth/open_cors_on_sensitive from the stateful bucket.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --check stateful --help (or the checks reference doc) explicitly lists which checks the 'stateful' selector includes, so ignored_auth/open_cors_on_sensitive showing up isn't a surprise
- [ ] #2 if the broad inclusion is unintended, ignored_auth/open_cors_on_sensitive are removed from the stateful category
<!-- AC:END -->
