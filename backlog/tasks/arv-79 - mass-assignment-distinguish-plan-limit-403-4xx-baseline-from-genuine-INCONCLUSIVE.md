---
id: ARV-79
title: >-
  mass-assignment: distinguish plan-limit 403/4xx baseline from genuine
  INCONCLUSIVE
status: To Do
assignee: []
created_date: '2026-05-11 07:34'
updated_date: '2026-05-16 10:55'
labels:
  - feedback-loop
  - api-resend
  - m-16
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F21, class ux-papercut. 20/32 mass-assignment classifications come back INCONCLUSIVE-BASE on a plan-limited account (Resend: 3 segments, 1 domain). These are not real failures — baseline POST hit a quota wall. Ask: tag plan-limited (403 plan_limit_reached, 402 payment_required) as 'skipped:plan-limit' in the digest, not INCONCLUSIVE. Log: apis/resend/probes/mass-assignment-digest.md
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
round-02 (R-02/F6): подтверждено повторно после расширения fixtures — owner/repo заполнены, baseline теперь 403 с Copilot reason, но categorization не учитывает body reason.
<!-- SECTION:NOTES:END -->
