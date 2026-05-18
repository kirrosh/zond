---
id: ARV-94
title: >-
  skill drift: zond-base.md presents --seed as silver bullet, no discriminator
  caveat
status: Done
assignee: []
created_date: '2026-05-11 07:50'
updated_date: '2026-05-16 08:21'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: skill-drift-summary SD11, severity low, drift-type=missing-caveat. Skill file: src/cli/commands/init/templates/skills/zond-base.md fixture loop section. After ARV-67/ARV-78, --seed handles top-level and discriminator-aware oneOf. Remaining gap: deeply-nested discriminator subschemas may still 422. Fix: known-limitation footer with manual .env.yaml fallback.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added 'silver bullet' caveat to zond.md Phase 1 — top-level + discriminator-aware oneOf are handled (ARV-67/78), but deeply nested oneOf subschemas (required fields inside chosen discriminator branch with own nested oneOf/anyOf) still 422. Right escape: annotate seed_body (Phase 2) or zond fixtures add. Don't loop on --cascade.
<!-- SECTION:NOTES:END -->
