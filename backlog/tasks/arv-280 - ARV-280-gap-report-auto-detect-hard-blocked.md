---
id: ARV-280
title: 'ARV-280: gap-report auto-detect hard-blocked'
status: Done
assignee: []
created_date: '2026-05-17 18:20'
labels:
  - annotate-auto
  - arv-277-followup
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

ARV-277 surface'ит worklist через gap-report. Часть resources (Stripe treasury/*, tokens, file_links) hard-blocked at account level — overlay-фикс не поможет, нужна сменa account capability. Прошлый dogfood-session тратил agent-time на узнавание этого вручную.

## Решение

Auto-detect через regex на error.message в N recent fixture-POSTs:
- HARD_BLOCKED_PATTERNS: `not supported for country`, `capability`, `not enabled`, `not onboarded`, `raw card data api`, `you do not have access`
- HARD_BLOCKED_MIN_ATTEMPTS = 2 (консервативно — нужно минимум 2 attempts ВСЕ match'нувшие regex)
- gap-report показывает `block_class` колонку, `--exclude-hard-blocked` фильтрует
- JSON envelope содержит `hard_blocked: N` count + `excluded: bool`

## Acceptance Criteria

- Consistent N attempts с capability-shaped error → tagged
- Mixed shapes (data error + capability error) → не tagged (conservative)
- `--exclude-hard-blocked` скрывает + sumсary "(N hard-blocked excluded)"

## Status

Done — commit (ARV-278/279/280/281/282 batch).
<!-- SECTION:DESCRIPTION:END -->
