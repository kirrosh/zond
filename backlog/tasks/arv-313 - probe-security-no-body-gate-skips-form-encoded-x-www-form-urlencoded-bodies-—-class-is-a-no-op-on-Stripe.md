---
id: ARV-313
title: >-
  probe security 'no-body' gate skips form-encoded (x-www-form-urlencoded)
  bodies — class is a no-op on Stripe
status: To Do
assignee: []
created_date: '2026-07-02 14:19'
labels:
  - probe
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260702-170615. 'zond probe security ssrf,crlf,open-redirect --dry-run' → Plan: 0 planned · 291 skipped · 291 total, every POST skipped as no-body. Same run, 'zond probe mass-assignment --dry-run' planned 290/291 of the SAME POST endpoints. Divergence: the security planner's no-body gate doesn't read application/x-www-form-urlencoded request bodies (Stripe's format), while the MA planner does. Net: the entire security-injection class produces an empty inventory on form-encoded APIs. Likely a shared body-surface detector that MA uses and security doesn't. Note: this also means ARV-300 severity calibration for the security probe has nothing to act on for such APIs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 security probe planner recognizes application/x-www-form-urlencoded body params as injection surface
- [ ] #2 on Stripe spec, security dry-run plans a comparable count to mass-assignment (not 0)
- [ ] #3 regression: form-encoded POST with body params is not skipped as no-body
<!-- AC:END -->
