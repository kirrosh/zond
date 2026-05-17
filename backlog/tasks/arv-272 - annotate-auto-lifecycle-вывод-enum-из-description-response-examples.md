---
id: ARV-272
title: 'annotate-auto lifecycle: вывод enum из description + response examples'
status: To Do
assignee: []
created_date: '2026-05-17 13:28'
updated_date: '2026-05-17 14:43'
labels:
  - annotate
  - annotate-auto
  - lifecycle
  - arv-262-followup
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`annotate auto` сейчас выводит lifecycle из status enum: `state`/`status` field с `enum: ["active", "canceled", ...]` ≥2 → observation-mode lifecycle config.

Но многие API (включая Stripe) **не** декларируют enum, а пишут допустимые значения в `description`:

```
status: { type: string, description: "Possible values: active, canceled, past_due, ..." }
```

Stripe: 111 resources с lifecycle-shape (`subscription.status`, `invoice.status`, `charge.status`), heuristic поймал 0 → `lifecycle_transitions: 111/111 skipped`.

## Расширение heuristic

Source A — **description text-mining**:
- regex `/(?:Possible|Allowed|Valid)\s+values?:?\s*([^.]+)/i`
- split на `, ` или `or` → enum candidate
- confidence: low (text-mining brittle); accept только если ≥3 distinct values

Source B — **response example clustering**:
- если schema has `examples:` или endpoint has `examples:` в responses
- собрать distinct `status` values из examples → enum candidate
- confidence: medium (real data from spec)

Если оба source дали enum и они совпадают → confidence: high.

## Цель

На Stripe sandbox после `annotate auto --aspect all --confidence high` появляются observation-mode lifecycle configs для `subscriptions`, `invoices`, `charges`, `disputes` (resources с богатой state-machine).

## Refs

- ARV-262 (annotate auto framework)
- Phase-1 report MF3
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 annotate auto парсит 'Possible values:' / 'Allowed values:' из description
- [ ] #2 annotate auto кластеризует distinct status values из spec examples
- [ ] #3 На Stripe появляется lifecycle config для subscriptions/invoices/charges/disputes
<!-- AC:END -->
