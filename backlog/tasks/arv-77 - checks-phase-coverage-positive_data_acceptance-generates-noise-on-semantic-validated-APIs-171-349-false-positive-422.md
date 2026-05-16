---
id: ARV-77
title: >-
  checks --phase coverage: positive_data_acceptance generates noise on
  semantic-validated APIs (171/349 false-positive 422)
status: Done
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-11 07:42'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F20, class missing-feature / likely_bug. Repro: zond checks run --api X --phase coverage --ndjson; expects 2xx on JSON-Schema-valid bodies, but real APIs reject by semantic rules (email domain not verified, broadcast missing pre-verified domain, etc.) → 422. 171/349 = positive_data_acceptance with 422 across all write endpoints; recommended_action=report_backend_bug but real fix is fix_generator or fix_spec_examples. Real depth signal (2 actual 5xx) drowns in noise. Ask: feed spec.examples or use --phase=examples body as positive baseline; or downgrade severity / add allowed-non-2xx pool for write probes. Log: ~/Projects/zond-test/.fb-loop/rounds/checks-03-cov.ndjson
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 positive_data_acceptance check skips findings for case.meta.phase=='coverage' && case.kind=='positive' (boundary bodies are synthetic)
- [x] #2 examples-phase positive (one realistic baseline body) is unchanged — real 422 there is still a signal
- [x] #3 negative_data cases from coverage phase still flow through negative_data_rejection guards
- [x] #4 regression test: 4 scenarios on the new guard + applyGuards composition unchanged
<!-- AC:END -->
