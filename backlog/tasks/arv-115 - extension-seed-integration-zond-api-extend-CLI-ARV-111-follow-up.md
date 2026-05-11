---
id: ARV-115
title: extension --seed integration + zond api extend CLI (ARV-111 follow-up)
status: To Do
assignee: []
created_date: '2026-05-11 09:38'
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
