---
id: ARV-78
title: >-
  prepare-fixtures --seed: synthesize NESTED required fields
  (steps[0].config.event_name) — follow-up of ARV-67
status: Done
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-11 07:39'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F25, class missing-feature (PARTIAL of F7). Repro: zond prepare-fixtures --api X --apply --cascade --seed → POST /automations → 422 'Missing steps, config, event_name'. ARV-67 fixed top-level shape (no more 'expected object, got string'), but generator does not walk discriminator-based subschemas — steps[0] needs type='trigger' + config.event_name when trigger-shaped. Ask: spec-examples fallback (--seed-from-examples picking up spec.paths.<path>.post.requestBody.content.examples), or honour discriminator + walk into chosen variant's required fields. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-04.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 generateFromSchema honours parent discriminator.propertyName: picks the oneOf/anyOf variant whose discriminator property has a single-value enum/const
- [x] #2 discriminator value is stamped onto the generated object (so API switching on the key gets the right shape)
- [x] #3 without discriminator, pickPreferredVariant path is unchanged
- [x] #4 F25 repro: automations.steps[0] generates {type: 'trigger', config: {event_name: '<value>'}}
- [x] #5 regression: existing data-factory tests stay green
<!-- AC:END -->
