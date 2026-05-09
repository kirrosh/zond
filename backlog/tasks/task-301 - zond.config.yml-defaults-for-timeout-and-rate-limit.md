---
id: TASK-301
title: 'zond.config.yml: defaults for --timeout and --rate-limit'
status: Done
assignee: []
created_date: '2026-05-09 07:00'
labels:
  - cli-surface
  - consolidation
  - m-13
milestone: m-13
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас --timeout / --rate-limit повторяются в командах. Сделать defaults в zond.config.yml (workspace-level + per-API override). Per-command флаги остаются как override. Эффект: -200 LOC, меньше повторов. Источник: audit-and-consolidation.md §4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond.config.yml поддерживает defaults.timeout_ms, defaults.rate_limit (+ camelCase aliases)
- [x] #2 cleanup / prepare-fixtures / probe mass-assignment / probe security / request / run читают defaults через resolveTimeoutMs / resolveRateLimit
- [x] #3 Per-API override через apis/<name>/.env.yaml (`timeoutMs:` / `rateLimit:`); чейн CLI > .env.yaml > workspace defaults > fallback
- [x] #4 ZOND.md (раздел Workspace defaults), init-template zond-config.yml, CHANGELOG, unit-тесты config.test.ts
<!-- AC:END -->
