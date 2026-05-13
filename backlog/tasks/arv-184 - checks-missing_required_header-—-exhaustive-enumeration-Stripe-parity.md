---
id: ARV-184
title: 'checks: missing_required_header — exhaustive enumeration (Stripe parity)'
status: To Do
assignee: []
created_date: '2026-05-13 08:35'
labels:
  - m-18
  - depth
  - parity-fix
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Закрыть schemathesis-only gap по `missing_required_header` (Stripe 42
endpoints в overlap'е, Sentry edge, Resend 0). По аналогии с ARV-179.

## Проблема

`buildMissingHeader` (runner.ts:194) дропает только **первый** required
header per operation: `const dropped = required[0]!.name`. На Stripe-style
API с несколькими required headers per op (Stripe-Version, Stripe-Account,
Idempotency-Key, ...) находим ≤1 finding per op vs schemathesis ~42.

## Фикс

Аналогично ARV-179: `buildMissingHeader` → `BuiltCase[]` (один per
required header, дроп в изоляции). runner.ts spread'ит.

## Замер

После: ожидаемая дельта на Stripe overlap — 0 → 30-42 findings, паритет
со schemathesis по этой категории.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 buildMissingHeader эмитит один case per required header (не только первый)
- [ ] #2 parity-замер на Stripe: 0 → ≥30 findings missing_required_header
<!-- AC:END -->
