---
id: ARV-102
title: 'probe security: cleanup-failures don''t reach orphans registry'
status: Done
assignee: []
created_date: '2026-05-11 08:36'
updated_date: '2026-05-11 08:43'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F7, class definitely_bug
API: sentry

Repro:
  zond probe security ssrf,crlf,open-redirect --api sentry \
    --emit-tests apis/sentry/probes/security \
    --output apis/sentry/probes/security-digest.md
  # → 'Warning: 5 orphan resource(s): cleanup DELETE failed (non-404).'
  zond cleanup --orphans
  # → 'No orphan resources to retry.'

Expected: per zond/SKILL.md L709-712, 'cleanup --orphans' must retry DELETE for resources logged in ~/.zond/orphans/. Each probe-cleanup-fail must land in this queue.

Actual: digest lists 5 unkilled resources with concrete reasons (cleanup skipped: response had no usable id, no DELETE counterpart for POST .../symbol-sources/), but cleanup --orphans finds 0. Real Sentry resources (api-keys, user-feedbacks, symbol-sources) remain.

Effect: silent leak of live API resources. Particularly bad for symbol-sources that retained SSRF payloads (http://127.0.0.1:80/, http://169.254.169.254/latest/meta-data/, file:///etc/passwd).

Log: $HANDOFF/rounds/raw-02.log section '=== cleanup orphans ===' + apis/sentry/probes/security-digest.md L7-13
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 probe security cleanup failures write to ~/.zond/orphans/ registry
- [x] #2 zond cleanup --orphans picks them up and retries DELETE
- [x] #3 Test pins probe → cleanup --orphans round-trip
<!-- AC:END -->
