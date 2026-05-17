---
id: ARV-263
title: 'doctor --json: surface secrets state alongside fixtures'
status: To Do
assignee: []
created_date: '2026-05-17 06:50'
labels:
  - feature
  - doctor
  - auth
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`zond doctor --api <name> --json` lists `fixtures.required[]` but does NOT show whether `auth_token` (or other `.secrets.yaml` keys) are set. User must reverse-engineer auth state via smoke `zond request GET /user --api <name>` and parse the response.

When spec lacks `securitySchemes` (e.g. GitHub OpenAPI), there's no other CLI signal that "auth IS configured and will be sent" — only the `zond request --help` text mentions auto-loading from `.secrets.yaml`.

Discovered: zond-scan on GitHub public REST API, 2026-05-17.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add `data.secrets[]` block to `zond doctor --json` envelope
- [ ] #2 Each entry: name, set: true|false, length: N (no value), used_by: [request, checks, probe]
- [ ] #3 Both `--missing-only` and full doctor modes include secrets
- [ ] #4 Test: empty .secrets.yaml → entries show set:false; populated → set:true with length
<!-- AC:END -->
