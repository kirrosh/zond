---
id: ARV-115
title: extension --seed integration + zond api extend CLI (ARV-111 follow-up)
status: To Do
assignee: []
created_date: '2026-05-11 09:38'
updated_date: '2026-05-16 08:25'
labels:
  - zond
  - cli
  - api-resources
  - fixtures
  - follow-up
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up of ARV-111 MVP (persistence + merge landed). Remaining scope:

1. **--seed via extensions**: prepare-fixtures --seed currently still requires a spec'd request-body schema, so extensions whose create endpoint isn't in OpenAPI (e.g. Sentry /store/) still can't be seeded by zond. Add a `requestBodyTemplate` field in .api-resources.local.yaml entries (inline JSON body that gets interpolated with .env vars) and let trySeed() take it as a fallback when no ep.requestBodySchema exists.

2. **CLI** `zond api extend <api>`:
   - `add <resource> --create METHOD:/path [--body-file file.json] [--id-param NAME] [--capture-field NAME]` — append/override entry
   - `list` — show current extensions
   - `remove <resource>` — delete an entry

3. **Provenance**: surface 'from extension' marker in prepare-fixtures perTarget when value came via extension-driven seed (parity with ARV-112).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 extensions carry requestBodyTemplate consumable by --seed
- [ ] #2 zond api extend add/list/remove CLI commands
- [ ] #3 perTarget.sourceEndpoint annotated when value came via extension
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Re-scope (2026-05-16 strategy review): parts 2 + 3 are SUPERSEDED by features shipped post-ARV-111.

ORIGINAL scope:
1. --seed via extensions (requestBodyTemplate fallback)
2. zond api extend add/list/remove CLI
3. provenance marker in perTarget

NEW scope (only part 1 survives):
- requestBodyTemplate field in .api-resources.local.yaml — inline JSON body for endpoints whose create-endpoint is NOT in OpenAPI (e.g. Sentry POST /api/<project>/store/)
- trySeed() consumes requestBodyTemplate as a fallback when ep.requestBodySchema is null
- {{var}} interpolation from .env.yaml inside the template

PARTS 2 + 3 — DROPPED:
- Part 2 (zond api extend CLI) superseded by zond api annotate (ARV-187, m-20): 'annotate dump --resources' already surfaces orphan endpoints; 'annotate apply' writes to .api-resources.local.yaml. Per memory env_yaml_editable, the .local.yaml is hand-editable, so dedicated add/list/remove CLI brings little marginal value over hand-edit + annotate.
- Part 3 (provenance) — niche, not requested in any recent feedback round.

Down-scope to part 1 only. Keep MEDIUM (still real gap for write-only ingest endpoints).
<!-- SECTION:NOTES:END -->
