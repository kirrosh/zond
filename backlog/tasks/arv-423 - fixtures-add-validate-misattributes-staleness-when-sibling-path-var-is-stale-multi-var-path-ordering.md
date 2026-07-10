---
id: ARV-423
title: >-
  fixtures add --validate misattributes staleness when sibling path-var is stale
  (multi-var path ordering)
status: Done
assignee: []
created_date: '2026-07-10 13:52'
updated_date: '2026-07-10 14:29'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry run#4 (m-28). `zond fixtures add file_id=7419635702 --validate --apply --api sentry` reported `[stale 404]` even though the id was genuinely live (manual GET on both org- and project-scoped release-files endpoints returned 200). Root cause: the fixture's affectedEndpoints entry is `GET /api/0/organizations/{organization_id_or_slug}/releases/{version}/files/{file_id}/` — a path with TWO template vars (version, file_id). At validation time version still held a stale pre-existing value, so the readback GET 404'd on the WRONG var, and the tool attributed the failure to file_id (the var actually being set) instead of version (the actually-stale sibling). Re-running the identical fixtures add file_id=... --validate --apply AFTER fixing version flipped the same file_id to [live 200] with no other change. Reproduced 3x this run on different fixtures: file_id (via releases/{version}/files/{file_id}/), team_id_or_slug (via .../scim/v2/Groups/{team_id_or_slug} — see the SCIM id-space mismatch task for that root cause), attachment_id (via events/{event_id}/attachments/{attachment_id}/, where the generic body-fk event_id var — not the namespaced events_event_id — was the stale sibling). Impact: false-stale verdicts waste warm-up iterations chasing the wrong fixture and can cause a genuinely-good id to be dropped from .env.yaml on --apply. Fix: before attributing a validate failure to the var being set, check whether every OTHER template var in the chosen affectedEndpoint is currently live in .env.yaml; if a sibling var is unresolved/stale, report the failure as 'blocked by stale sibling <var>' rather than misattributing it to the var under test. Evidence: zond-runs/sentry-run4-20260710/raw/.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in fixtures add --validate: each path-var in the readback endpoint resolves from its OWN env var; an empty SIBLING is reported as 'blocked by stale sibling {var}' instead of false-'stale'-ing the var under test. Deterministic (per-param resolution). Unit test locks it.
<!-- SECTION:NOTES:END -->
