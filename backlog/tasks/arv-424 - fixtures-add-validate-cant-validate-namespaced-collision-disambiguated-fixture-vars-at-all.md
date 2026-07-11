---
id: ARV-424
title: >-
  fixtures add --validate can't validate namespaced/collision-disambiguated
  fixture vars at all
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
Sentry run#4 (m-28). Sentry's fixture manifest disambiguates path params that collide across resources by namespacing the var name (e.g. raw param 'event_id' used by 5 unrelated resources becomes events_event_id, eventids_event_id; 'issue_id' becomes issues_issue_id, shortids_issue_id; 'organization_id_or_slug' becomes organizations_organization_id_or_slug, projects_organization_id_or_slug, teams_organization_id_or_slug; 'team_id_or_slug' becomes teams_team_id_or_slug, Groups_team_id_or_slug; 'member_id' becomes members_member_id, Users_member_id — 10+ such vars in Sentry's manifest alone, gating 60+ endpoint-slots). Every attempt to validate one of these via 'zond fixtures add <namespaced_var>=<value> --validate --apply' reported '[unknown] — no GET endpoint with {<namespaced_var>} in path', e.g. 'events_event_id = 02e7ea779a4442efa034ff57a4d774d6 [unknown] — no GET endpoint with {events_event_id} in path' even though the manifest's own affectedEndpoints list for that exact var includes 'GET /api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/events/{event_id}/' — a real endpoint that DOES return 200 for that value (confirmed manually via zond request). Root cause: --validate resolves the GET endpoint to hit by searching the spec for a literal path placeholder matching the fixture's DISPLAY/manifest name, instead of using the fixture's own affectedEndpoints list (which correctly uses the RAW un-namespaced param name, e.g. {event_id} not {events_event_id}). This makes --validate silently useless for exactly the fixtures ambiguous enough to need disambiguating in the first place — 10/10 namespaced vars tested this run hit '[unknown]', 0/10 validated correctly, despite all 10 being genuinely live when checked manually. Fix: --validate should resolve the readback endpoint via the fixture manifest's own affectedEndpoints entries (substituting the raw param name), not by re-deriving a path placeholder from the fixture's storage key. Evidence: zond-runs/sentry-run4-20260710/raw/, apis/sentry/.api-fixtures.yaml.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: --validate resolves the readback endpoint via the fixture manifest's own affectedEndpoints (raw {event_id}) instead of placeholder-matching the namespaced storage key ({events_event_id}) which found nothing. Verified live on Sentry: events_event_id/eventids_event_id now resolve to the correct GET endpoint (was '[unknown] no GET endpoint'). Note: my ARV-417 change was the root cause of this; now corrected. Unit tests added.
<!-- SECTION:NOTES:END -->
