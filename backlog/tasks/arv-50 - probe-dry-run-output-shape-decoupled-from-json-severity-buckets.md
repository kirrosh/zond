---
id: ARV-50
title: 'probe: --dry-run output shape decoupled from --json severity buckets'
status: To Do
assignee: []
created_date: '2026-05-10 18:44'
labels:
  - m-17
  - probe
  - dry-run
  - json-envelope
  - agent-contract
dependencies:
  - ARV-49
priority: high
milestone: m-17
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-15 F1 (medium). probe security --dry-run --json возвращает 'severity.skipped: 32' даже при том, что 14 endpoints это 'would attack' (planned), не skipped. CI который смотрит severity.skipped == data.totalEndpoints чтобы решить 'можно мерджить' — ошибётся: при удалении --dry-run он внезапно увидит 14 LIVE-attacks. Severity по определению неприменима в dry-run — там ничего не выполнено. Этой задачей dry-run получает свой data-shape: data.endpoints[] с planned/skipped enum, severity отсутствует или null.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probe security --dry-run --json: data.endpoints[] = [{path, method, planned: boolean, classes_planned: string[], fields_planned: string[], skip_reason: null | 'no-body' | 'no-matched-field' | 'isolated-protected'}]
- [ ] #2 data.severity отсутствует (или явно null с комментарием 'severity not applicable in dry-run')
- [ ] #3 data.summary содержит { totalEndpoints, planned, skipped } — отдельные счётчики
- [ ] #4 Resend F1-15 fixture-test: dry-run возвращает 14 endpoints planned:true, 18 planned:false с skip_reason
- [ ] #5 Schema published в docs/json-schema/probe-dry-run.schema.json
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. dryRun() в Probe interface возвращает EndpointPlan[].\n2. envelope-builder для probe команд при --dry-run: писать data.endpoints, не data.severity.\n3. markdown-renderer (для --output) остаётся, но separately: pendantPath markdown.\n4. Update existing probe-security и probe-mass-assignment под этот формат.
<!-- SECTION:PLAN:END -->
