---
id: ARV-104
title: 'probe mass-assignment: distinguish 403 paid-plan baseline from fixture issues'
status: Done
assignee: []
created_date: '2026-05-11 08:36'
updated_date: '2026-05-11 08:46'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F9, class ux-papercut
API: sentry

Repro:
  zond probe mass-assignment --api sentry --emit-tests … --output …
  # → 'PUT /api/0/organizations/{organization_id_or_slug}/ — baseline body invalid —
  #    server returned 403 (A paid plan is required to enable this feature.) —
  #    fix fixture / FK value / path-params and re-probe'

Expected: zond already sees the response body 'A paid plan is required'. This is env_issue (subscription scope), not fixture-issue. There should be a separate bucket 'inconclusive — env/subscription gated' + action wontfix_known_limitation, so the agent doesn't try to 'fix fixtures'.

Actual: all 46 INCONCLUSIVE bucket under generic 'fix fixture / FK value / path-params and re-probe', even when the response body explicitly states the endpoint is unavailable on free tier (or requires SSO/Member-of-Team scope).

Effect: 46 endpoints look like 'need to fix fixtures' but actually it's an organisation feature-flag. Wasted time per pull-cycle manually checking token scope.

Log: apis/sentry/probes/mass-assignment-digest.md L7-1065 (INCONCLUSIVE block); $HANDOFF/rounds/raw-02.log block 'probe mass-assignment live'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Mass-assignment classifier detects 403 with subscription/paid-plan response body
- [ ] #2 Such verdicts get severity 'inconclusive-subscription' (or similar bucket) and recommended_action 'wontfix_known_limitation'
- [x] #3 Test pins paid-plan body → distinct bucket
<!-- AC:END -->
