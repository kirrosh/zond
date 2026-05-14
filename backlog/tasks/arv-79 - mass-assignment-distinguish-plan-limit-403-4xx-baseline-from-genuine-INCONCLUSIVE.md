---
id: ARV-79
title: >-
  mass-assignment: distinguish plan-limit 403/4xx baseline from genuine
  INCONCLUSIVE
status: To Do
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-14 10:40'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F21, class ux-papercut. 20/32 mass-assignment classifications come back INCONCLUSIVE-BASE on a plan-limited account (Resend: 3 segments, 1 domain). These are not real failures — baseline POST hit a quota wall. Ask: tag plan-limited (403 plan_limit_reached, 402 payment_required) as 'skipped:plan-limit' in the digest, not INCONCLUSIVE. Log: apis/resend/probes/mass-assignment-digest.md
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
round-01 (R-01/F4): подтверждено на github mass-assignment — 286 endpoints с Copilot 403 свалены в INCONCLUSIVE-BASELINE
<!-- SECTION:NOTES:END -->
