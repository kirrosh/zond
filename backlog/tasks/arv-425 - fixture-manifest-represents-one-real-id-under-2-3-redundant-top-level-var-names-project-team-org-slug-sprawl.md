---
id: ARV-425
title: >-
  fixture-manifest represents one real id under 2-3 redundant top-level var
  names (project/team/org slug sprawl)
status: Done
assignee: []
created_date: '2026-07-10 13:52'
updated_date: '2026-07-10 14:30'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry run#4 (m-28). The SAME real-world identifier is represented under multiple, entirely separate top-level fixture vars that don't sync with each other. Example: a project slug is needed under THREE different manifest keys — project_id_or_slug (capture-chain, optional, shown as satisfied early), projects_project_id_or_slug (namespaced, gates 1 endpoint: POST .../projects/{project_id_or_slug}/detectors/), and _organization_id_or_slug__project_id_or_slug (compound-key, gates 10 endpoints: the core project CRUD + events + environments group — the single largest endpoint-count of any fixture in the whole manifest). Same pattern for team slug: team_id_or_slug (optional/satisfied) vs teams_team_id_or_slug vs _organization_id_or_slug__team_id_or_slug (9 endpoints). A user who fills the friendly, prominently-shown bare name (project_id_or_slug, marked satisfied in doctor's 'Optional fixtures' bucket) reasonably believes project-related endpoints are unblocked, while up to 19 more endpoints stay gated behind oddly-named shadow variables (leading underscore, double-underscore compound naming) that only surface by reading doctor's FULL required-fixtures table closely. This run: filling project_id_or_slug + team_id_or_slug alone left 19 endpoints still blocked until the compound-key vars were independently discovered and filled with the identical values. Recommendation: when two+ manifest vars are proven to require the exact same real-world value (same resource, same id-space, confirmed by a shared capture-chain source or identical affectedEndpoints path segment), either merge them into one canonical var name that all affectedEndpoints reference, or auto-propagate a value written to one into the others at write-time (zond fixtures add / prepare-fixtures --cascade). Evidence: zond-runs/sentry-run4-20260710/raw/, apis/sentry/.api-fixtures.yaml (_organization_id_or_slug__project_id_or_slug, _organization_id_or_slug__team_id_or_slug entries).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECLINED (philosophy), no code change. The ASK — auto-propagate a value written to one var into sibling vars (prepare-fixtures --cascade) — is exactly the cascade/heuristic layer removed in m-24. Deciding two same-named vars share a real-world value is JUDGMENT (the SCIM case in ARV-424 proves same param name ≠ same id-space: REST slug vs SCIM numeric), which belongs to the agent, not zond. The manifest namespacing is CORRECT — merging vars would misapply one id across resources that don't own it (the exact ARV-369 bug it prevents). zond already emits the evidence (each var's affectedEndpoints show what it gates); the agent fills them. Separate note: the compound-key naming scheme (_org__project) vs path-namespacing (projects_project_id_or_slug) is a possible manifest-consistency item, but unifying them is a careful standalone investigation, not a batch fix, and risks the SCIM disambiguation.
<!-- SECTION:NOTES:END -->
