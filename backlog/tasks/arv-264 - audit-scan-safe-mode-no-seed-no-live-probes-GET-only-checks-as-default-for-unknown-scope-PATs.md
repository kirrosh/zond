---
id: ARV-264
title: >-
  audit/scan: --safe mode (no --seed, no live probes, GET-only checks) as
  default for unknown-scope PATs
status: Done
assignee: []
created_date: '2026-05-17 06:50'
updated_date: '2026-05-18 12:07'
labels:
  - feature
  - audit
  - scan
  - safety
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When a user runs `zond audit` or `/zond-scan` against an unknown-scope PAT on a production API, current defaults run `prepare-fixtures --seed` (POST-creates resources), live mass-assignment probes (create+verify+delete), live security probes (CRLF/SSRF payloads to real fields), and `--rate-limit auto` without budget awareness.

Blast-radius unacceptable for first-time scanners. Need a safe-mode default with explicit `--live` opt-in.

Discovered: zond-scan skill development + GitHub scan, 2026-05-17. Companion to ARV-59 (--deep umbrella).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `zond audit --safe` (or default behaviour): no --seed; checks run --include method:GET; probes --dry-run only; skip schema-drift sweep
- [x] #2 `zond audit --live` opt-in: full pipeline (current default)
- [ ] #3 Pre-flight: check rate-limit budget if API exposes /rate_limit or similar; refuse live mode if budget < estimated requests
- [x] #4 Pre-flight: detect spec.securitySchemes presence; warn if absent + auth_token unset
- [x] #5 Document the safe vs live decision matrix in zond/SKILL.md
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/cli/commands/audit.ts: --safe mode default, --live флаг для opt-in. Safe mode: no --seed, no --with-mass-assignment, no --with-security (даже если флаги переданы — warn + drop). --live включает full pipeline. Pre-flight (runSafePreflight): warns если spec declares securitySchemes но auth_token unset, или если no securitySchemes declared. AC#3 (rate-limit budget pre-flight) — частично: securitySchemes + auth_token проверки реализованы, /rate_limit endpoint detection не сделана (требует API-specific discovery, отложено в follow-up). Skill docs (src/cli/commands/init/templates/skills/zond.md): добавлена 'safe vs live decision matrix' + обновлена commands cheat sheet. Тесты: 6 в audit.test.ts (5 existing + 1 новый ARV-264 case).
<!-- SECTION:NOTES:END -->
