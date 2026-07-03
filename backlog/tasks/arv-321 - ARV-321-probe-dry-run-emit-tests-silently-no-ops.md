---
id: ARV-321
title: 'ARV-321: probe --dry-run --emit-tests silently no-ops'
status: Done
assignee: []
created_date: '2026-07-02 16:41'
updated_date: '2026-07-02 16:41'
labels:
  - probe
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on the 2026-07-02 19:10 clean Stripe re-run (report-zond UX papercut #2). '--emit-tests <dir>' combined with '--dry-run' left the target directory empty with zero signal on stdout/stderr that the flag was ignored -- reads as a bug rather than a documented no-op (there are no live verdicts on dry-run to turn into regression suites). Both probe mass-assignment and probe security now printWarning() the reason + how to get real output (re-run without --dry-run).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probe mass-assignment --dry-run --emit-tests <dir> warns on stderr that it's a no-op
- [ ] #2 probe security --dry-run --emit-tests <dir> warns on stderr that it's a no-op
- [ ] #3 --dry-run without --emit-tests stays silent about it (no false-positive warning)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
printWarning() added to both probe mass-assignment and probe security dry-run branches when --emit-tests is set. Test: probe-output-spec.test.ts +3 (mass-assignment warns, security warns, no-emit-tests stays silent).
<!-- SECTION:NOTES:END -->
