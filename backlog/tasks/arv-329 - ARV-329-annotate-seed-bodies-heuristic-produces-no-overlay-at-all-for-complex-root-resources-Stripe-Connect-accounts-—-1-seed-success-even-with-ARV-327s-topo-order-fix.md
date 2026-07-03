---
id: ARV-329
title: >-
  ARV-329: annotate seed-bodies heuristic produces no overlay at all for complex
  root resources (Stripe Connect accounts) — 1% seed success even with ARV-327's
  topo-order fix
status: To Do
assignee: []
created_date: '2026-07-03 10:08'
labels:
  - annotate
  - seed-body
  - prepare-fixtures
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit live run 20260703-115146, AFTER both ARV-324 (fixture-gap-aware recommended_action) and ARV-327 (topological seed ordering + body-FK defer) shipped and were confirmed working end-to-end: seed success rose from 0/33-34 to 1/67 (customer_balance_transactions, via an existing overlay entry), and body-FK deferral now cleanly skip-no-creates external_account_id/person instead of firing garbage POSTs (raw/02-fixtures.log). But the root blocker is untouched: POST /v1/accounts still 400s every time, and .api-resources.local.yaml has ZERO seed_body entry for the 'accounts' resource (only a pagination patch) -- annotate auto's heuristic (src/cli/commands/api/annotate/auto.ts) apparently can't produce anything for this resource at all, so prepare-fixtures --seed falls back to the generic schema-driven generator (buildCreateRequestBody), which sends random placeholder values Stripe's real Connect-account validator rejects outright (business_type is a discriminated union requiring company/individual/government_entity/non_profit-specific sub-fields, tos_acceptance, capabilities, country are all effectively required in practice even though the spec may mark them optional/anyOf). Since 'accounts' has zero fkDependencies (it's the graph root), ARV-327's ordering/defer fixes structurally cannot help here -- this is purely a seed_body CONTENT-quality gap. Impact: because Stripe's whole Connect-nested resource tree (external_accounts, people, cards, payouts, financial_accounts, ...) hangs off 'account', this single unresolved root keeps ~30-40% of path-FK vars permanently unfillable and caps mass-assignment probe coverage regardless of any other fix. This overlaps ARV-270's scope (already marked Done) but is evidently insufficient for resources this complex -- either ARV-270's heuristic needs to go deeper (e.g. recognize discriminated-union required fields and emit a valid variant, not just flat scalar defaults), or annotate needs an explicit 'this resource's create endpoint is too complex for auto-heuristics, needs an LLM-authored seed_body' escape hatch (zond api annotate seed-bodies, the agent-loop LLM path already scaffolded per ARV-187) that gets flagged/attempted automatically when auto's heuristic produces zero candidates for a resource on the dependency-graph root.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond api annotate auto --api stripe --aspect seed-bodies --gap-report flags 'accounts' as a resource it couldn't produce a seed_body for (not silently skipped)
- [ ] #2 POST /v1/accounts succeeds end-to-end on a live Stripe test-mode account after either an improved heuristic or an LLM-authored overlay for this resource, unblocking the downstream nested tree
<!-- AC:END -->
