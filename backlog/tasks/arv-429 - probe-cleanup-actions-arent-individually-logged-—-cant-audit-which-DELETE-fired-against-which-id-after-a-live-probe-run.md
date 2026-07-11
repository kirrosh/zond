---
id: ARV-429
title: >-
  probe cleanup actions aren't individually logged — can't audit which DELETE
  fired against which id after a live probe run
status: Done
assignee: []
created_date: '2026-07-10 13:53'
updated_date: '2026-07-10 14:30'
labels:
  - m-28
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry run#4 (m-28). Created a throwaway release (zond-warmup-<ts>) and monitor (zond-warmup-monitor) during warm-up, confirmed live via GET immediately before running 'zond probe security ssrf,crlf,open-redirect --api sentry --tag Releases,Monitors --isolated --live' followed by 'zond probe mass-assignment --api sentry --tag Releases,Monitors --live'. Both resources were gone (404 on GET) immediately after. Likely benign (probe's own designed cleanup of resources it touched during baseline testing) but could not be confirmed from the console/report output — neither probe command's output names which DELETE calls it issued against which specific resource ids, so there is no way to distinguish 'probe correctly cleaned up its own test resource' from 'probe deleted a pre-existing/seeded fixture it mistook for its own' (the same risk family as ARV-368/ARV-428) without independently re-checking every touched resource by hand, which does not scale past a couple of fixtures. Compounding factor: 'probe security' exposes --isolated (protects seeded path-params from PUT/PATCH mutation) but 'probe mass-assignment --help' shows no equivalent flag — its PUT/PATCH baseline tests appear to run directly against seeded fixtures with no opt-out. Recommendation: (1) probe cleanup (and any probe-initiated DELETE) should log the specific id + endpoint + why (e.g. 'created by this probe run at <step>' vs any other reason) so post-run audits don't require manual re-verification of every fixture; (2) consider adding --isolated (or equivalent seeded-fixture protection) to probe mass-assignment to match probe security. Evidence: zond-runs/sentry-run4-20260710/raw/ (release/monitor confirmed live pre-probe, 404 post-probe).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed part (1): mass-assignment probe cleanup now returns an audit record (id + deletePath + status/error) attached to verdict.cleanup, so a post-run audit can tell a benign self-cleanup from a risky one without re-checking by hand. The deleted id comes from the baseline POST's own response body (self-created), documented. Part (2) --isolated for mass-assignment deferred: separate feature, not needed for the audit-trail fix.
<!-- SECTION:NOTES:END -->
