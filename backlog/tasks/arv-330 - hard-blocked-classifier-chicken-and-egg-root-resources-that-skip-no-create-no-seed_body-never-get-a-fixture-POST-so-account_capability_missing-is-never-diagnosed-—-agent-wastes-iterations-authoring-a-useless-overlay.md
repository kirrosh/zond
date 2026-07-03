---
id: ARV-330
title: >-
  hard-blocked classifier chicken-and-egg: root resources that skip-no-create
  (no seed_body) never get a fixture-POST, so account_capability_missing is
  never diagnosed — agent wastes iterations authoring a useless overlay
status: Done
assignee: []
created_date: '2026-07-03 10:57'
updated_date: '2026-07-03 11:05'
labels:
  - annotate
  - gap-report
  - hard-blocked
  - ARV-329-followup
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered while spot-testing ARV-329's fix on live Stripe. classifyHardBlocked (src/cli/commands/api/annotate/index.ts) only reads run_kind='fixture' POSTs via getRecentFixturePosts, and requires >=2 all-matching attempts. But a root resource with no seed_body (e.g. Stripe 'accounts') is skip-no-create by prepare-fixtures — zero fixture POSTs ever recorded — so block_class stays null forever, even though a live POST /v1/accounts returns 400 'You can only create new accounts if you've signed up for Connect' (a deterministic account-level capability gate, not a body-content problem). Two compounding gaps: (1) source too narrow — check/probe/run POSTs to the same create-path carry the capability evidence but are ignored; (2) HARD_BLOCKED_PATTERNS lacks the 'signed up for connect' phrasing. Net effect: gap-report tells the agent 'author overlay via dump' for a resource where no overlay can ever succeed — the account must be onboarded in Connect. Fix: widen the classifier's source to any-run_kind POST to the create-path (filtering out auth-probe noise from deliberately-broken creds), relax all-match to 'no 2xx success + >=1 capability-pattern hit' since a capability gate is deterministic, and add the Connect phrasing to the pattern list.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 getRecentCreatePosts (or equivalent) surfaces POST attempts to a create-path regardless of run_kind, so check/probe/run evidence counts
- [x] #2 classifyHardBlocked filters out auth-probe noise (401/403 + 'invalid API key'-shaped bodies) and tags account_capability_missing when there's no 2xx success and >=1 capability-pattern hit
- [x] #3 'signed up for connect' is recognized by HARD_BLOCKED_PATTERNS
- [x] #4 on the live-tested workspace, gap-report shows 'accounts' with block_class=account_capability_missing instead of null
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + verified live. getRecentCreatePosts (src/db/queries/results.ts) — any-run_kind POST source with optional SQL child-exclude pattern so a burst of probe sub-calls (/v1/accounts/{id}/reject|persons) can't starve the LIMIT window. classifyAttempts + urlMatchesCreatePath (annotate/index.ts) — pure, unit-tested: drops auth-probe noise (401/403 + 'invalid API key' bodies), segment-exact create-path match, tags account_capability_missing on no-2xx + >=1 capability hit (relaxed from all-match since the gate is deterministic). Added 'signed up for connect' to HARD_BLOCKED_PATTERNS. Both classifyHardBlocked and --explain now share the widened source. Verified on live Stripe workspace: accounts flips null -> account_capability_missing, gap-report shows '1 flagged hard-blocked'. Tests: annotate-arv-278-282 (classifyAttempts x7, urlMatchesCreatePath x4), last-fixture-post (getRecentCreatePosts x2). Full cli+db suite 599 pass.
<!-- SECTION:NOTES:END -->
