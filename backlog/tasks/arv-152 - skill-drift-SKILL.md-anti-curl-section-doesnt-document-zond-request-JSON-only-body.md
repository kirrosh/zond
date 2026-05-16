---
id: ARV-152
title: >-
  skill drift: SKILL.md anti-curl section doesn't document zond request
  JSON-only body
status: To Do
assignee: []
created_date: '2026-05-12 09:12'
updated_date: '2026-05-16 07:35'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding SD2, class skill-drift/gap

Skill: .claude/skills/zond/SKILL.md anti-curl section + Phase 2.5 + Phase 5.1
Severity: medium

What skill says: zond request POST /<path> --body '{...}' universally recommended for ad-hoc resource creation
What CLI does: always sends Content-Type: application/json. Fails on form-encoded APIs (Stripe v1) with 400.

Fix: after ARV-149 lands (zond request --form), update skill to mention 'use --form for form-encoded APIs (Stripe-style); inspect requestBody.content in catalog/spec to choose'. Block on ARV-149.

Log: $HANDOFF/rounds/feedback-02.md
<!-- SECTION:DESCRIPTION:END -->
