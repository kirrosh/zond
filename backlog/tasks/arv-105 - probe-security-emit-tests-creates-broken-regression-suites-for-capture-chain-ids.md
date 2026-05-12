---
id: ARV-105
title: >-
  probe-security --emit-tests creates broken regression suites for capture-chain
  ids
status: Done
assignee: []
created_date: '2026-05-11 08:36'
updated_date: '2026-05-11 08:48'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F10, class likely_bug
API: sentry

Repro:
  zond probe security ssrf,crlf,open-redirect --api sentry --emit-tests apis/sentry/probes/security
  zond run apis/sentry/probes/security --rate-limit auto --report json
  # → suite 'PUT /api/0/organizations/{organization_id_or_slug}/monitors/{monitor_id_or_slug}/'
  #   total=3 passed=0 failed=0 skipped=3 (all skipped — no {{monitor_id_or_slug}}
  #   in env.yaml; manifest marks it capture-chain)

Expected: either emit-tests does NOT write a regression suite if it depends on a var unfillable by prepare-fixtures, or it embeds a 'setup: true' step that creates the resource in-suite.

Actual: suite emitted, runtime warns undefined-variable and skips all probe-steps; in JSON-report it looks like 'green' suite (0 failed) — visibility-pitfall.

Effect: regression suites look valid in CI but actually validate nothing. Green repo, uncovered surface.

Log: $HANDOFF/rounds/raw-02.log block '=== run security probes ==='; .fb-loop/rounds/run-02-sec.json
Related: skill-drift SD6
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Suite skipped entirely (no step ran) due to unbound vars surfaces as a non-passing outcome
- [x] #2 Visible in run summary / JSON envelope, not silently green
- [x] #3 Test pins the regression-skip surfacing
<!-- AC:END -->
