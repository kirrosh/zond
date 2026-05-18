---
id: ARV-279
title: 'ARV-279: gap-report --explain <resource>'
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

ARV-277 рабочий flow для agent-loop: `gap-report` → выбор resource → `dump --with-last-attempt`. Это 2 команды per resource. Subagent dogfooding показал, что часто хочется one-shot: получить ВСЁ необходимое для выбранного resource'а в одном вызове.

## Решение

`zond api annotate auto --gap-report --explain <resource>` — single-resource verbose mode. Output (JSON):
- `resource`, `aspect`, `downstream_endpoints_blocked`, `block_class`
- `heuristic_inference`: `{confidence, rationale, proposed_seed_body}`
- `spec_slice`: full ResourceSlice (endpoints, required, properties, descriptions)
- `attempt_history`: last 5 fixture POSTs (newest first)
- `next_steps`: 2-3 actionable hints (e.g. "Read attempt_history[0].error.param", "Check attempt_history[1..N] for cascade-staleness pattern")

## Acceptance Criteria

- `--explain <resource>` требует `--gap-report` (sole-mode flag)
- Unknown resource → error с подсказкой `zond refresh-api`
- next_steps учитывает block_class (account_capability_missing → "skip or change account")
- Тесты на построение спецификации (covered indirectly через Stripe sanity-check)

## Status

Done — commit (ARV-278/279/280/281/282 batch).
<!-- SECTION:DESCRIPTION:END -->
