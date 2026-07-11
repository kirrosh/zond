---
id: ARV-428
title: >-
  CRUD-suite always:true DELETE step falls back to stale shared .env.yaml value
  when create-capture fails at RUNTIME (ARV-368 gap)
status: Done
assignee: []
created_date: '2026-07-10 13:53'
updated_date: '2026-07-10 14:30'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry run#4 (m-28), --safe run. Follow-up to ARV-368 (fixed: DELETE step is only EMITTED at generation time when the create step's response schema declares a capture field). Gap: ARV-368's fix guards EMISSION, not RUNTIME success. members-crud.yaml's addOrganizationMember step DOES declare id: capture: member_id (so DELETE is correctly emitted per ARV-368) — but if that create step fails or doesn't actually return the field AT RUNTIME (observed cause here: POST with sendInvite:true + {{$randomEmail}} against a real org, plausible causes include invite-domain restrictions or plan limits), the capture never overwrites {{member_id}}, and the terminal deleteOrganizationMember step — marked always: true, i.e. 'run regardless of upstream step failures' — still fires DELETE against WHATEVER value already sat in .env.yaml. In this run that pre-existing value was member_id=10816603, the organization's real (sole) owner membership. --safe correctly limited execution to GET-only steps this run, so no DELETE was actually sent and no data was lost (confirmed via direct GET: owner membership intact, isOnlyOwner true) — but under --live the same suite would have attempted to DELETE the account owner's membership using a fixture value that was never captured by this run's own create step. This is the same failure family as ARV-368 (delete-by-shared-fixture-instead-of-self-captured-id) but occurring at a different layer: generation-time schema inspection can't catch a runtime capture failure. Fix candidates: (a) gate the always:true DELETE step on the runtime capture actually having succeeded this run (e.g. track whether {{member_id}} was written by THIS run's create step vs pre-existed in .env.yaml, skip delete if pre-existing), or (b) drop always:true for delete steps whose id came from a failed/skipped create in the same run. Evidence: zond-runs/sentry-run4-20260710/raw/, apis/sentry/tests/crud-members.yaml, run JSON showing getOrganizationMember/Verify-member-deleted operating on the pre-existing owner id after create was dropped under --safe.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed (safety near-miss): executor now tracks capturedThisRun; an always:true cleanup step referencing a chain-capture var that was NOT produced this run but holds a non-empty stale env value is SKIPPED instead of firing. Scoped to always:true + non-empty (deterministic structural property — always:true bypasses the normal missing-capture skip; normal steps still read legitimately pre-seeded fixtures; empty vars keep the existing 'chain capture unbound' message). Test reproduces the Sentry scenario (dropped create + stale owner id → no DELETE fired).
<!-- SECTION:NOTES:END -->
