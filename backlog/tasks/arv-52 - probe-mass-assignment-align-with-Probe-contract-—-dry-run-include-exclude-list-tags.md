---
id: ARV-52
title: >-
  probe-mass-assignment: align with Probe contract — --dry-run,
  --include/--exclude, --list-tags
status: Done
assignee: []
created_date: '2026-05-10 18:44'
updated_date: '2026-05-10 19:55'
labels:
  - m-17
  - probe
  - mass-assignment
  - agent-contract
milestone: m-17
dependencies:
  - ARV-49
  - ARV-50
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-15 F2 (medium) + ARV-9 AC#6 deferred. zond probe mass-assignment --dry-run отвечает 'unknown option', хотя у probe security он есть. Probe-family асимметричный: каждая команда добавлялась со своим набором флагов. Mass-assignment особенно опасен (POST/PATCH с подсунутыми полями is_admin/role/account_id), и без --dry-run юзер не может предварительно увидеть scope атаки. Блокер для production-аудита: невозможно review-нуть план.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond probe mass-assignment --help содержит --dry-run, --list-tags, --include, --exclude (как у probe security)
- [x] #2 zond probe mass-assignment --dry-run --json возвращает data.endpoints[] с {path, method, fields_planned: ['is_admin', 'role', ...], target_method: POST|PATCH|PUT, skip_reason: null | 'no-body' | 'isolated-protected'}
- [x] #3 F2-15 fixture-test: на resend dry-run возвращает all POST/PATCH endpoints с suspect fields enum
- [x] #4 ARV-9 AC#6 закрывается (probe-семейство wired в --include/--exclude через harness)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. После ARV-49 (Probe interface) — переписать mass-assignment как Probe-class.\n2. dryRun() использует уже существующий field-detector (raw-15.log:115-138 показывает что детектор есть, просто --dry-run не wired).\n3. Common flags парсятся через harness — не повторять argv-handling в commands/probe-mass-assignment.ts.\n4. Тест: mass-assignment --dry-run на resend возвращает endpoints[] с fields_planned enum.
<!-- SECTION:PLAN:END -->
