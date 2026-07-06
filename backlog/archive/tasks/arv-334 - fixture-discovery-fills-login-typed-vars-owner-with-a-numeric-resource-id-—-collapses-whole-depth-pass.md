---
id: ARV-334
title: >-
  fixture discovery fills login-typed vars (owner) with a numeric resource id —
  collapses whole depth pass
status: To Do
assignee: []
created_date: '2026-07-03 19:25'
labels:
  - prepare-fixtures
  - discovery
  - fixture-quality
  - evidence-backed
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on GitHub zond-audit run 20260703-215535 (raw/02-fixtures.log, .env.yaml). prepare-fixtures --apply (no --seed) filled BOTH owner and repo path-vars with the numeric repo id 455602789 -> every repo-scoped request hit GET /repos/455602789/455602789/... which 404s (a numeric id is not a valid owner login). Cascade effect: 7021x404 status distribution, degenerate baseline (2279 status_code_conformance findings auto-suppressed as broken_baseline), 131 of 182 smoke failures, and only 5% of endpoints ever returned 2xx. Manually re-pointing owner=kirrosh / repo=<real> lifts real 2xx coverage dramatically. Discovery should reject a numeric resource id for a login/slug-typed var (owner/username/org), or pair the id with its resolved login, so one mis-typed FK cannot collapse the entire depth pass. Related but distinct from ARV-142/ARV-143 (refresh overwrite/ignore of user vars).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 discovery does not place a numeric resource id into a login/slug-typed path var (owner, username, org, repo-name)
- [ ] #2 when only a numeric id is discoverable for such a var, it is left empty (miss-status) rather than filled with a value guaranteed to 404
- [ ] #3 GitHub audit no longer degenerates to a 404-baseline solely from an owner/repo type mismatch
<!-- AC:END -->
