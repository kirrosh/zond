---
id: ARV-187
title: 'zond api annotate: LLM-pass для .api-resources.local.yaml'
status: To Do
assignee: []
created_date: '2026-05-13 11:53'
labels:
  - m-20
  - depth
  - agent-augmented
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Agent-authored declarative yaml workflow для m-20. См. backlog/notes/m-20-validation.md.

Подкоманды: --lifecycle, --idempotency, --pagination, --readback, --resources. Каждая делает LLM-pass над spec'ом и пишет в .api-resources.local.yaml через ARV-111 overlay. Diff показывается перед записью; --yes для approve. LLM provider — Anthropic или Ollama (--local-model).

После прогона annotate на Stripe spec'е almetric:
- lifecycle: ≥3 ресурса с state-machine
- idempotency: ≥10 POST endpoint'ов помечены
- pagination: ≥5 list endpoint'ов с cursor-блоком
- readback: ≥1 write_to_read_map предложен

Зависимости: ARV-111 (overlay), ARV-169/170/171/172 (читатели).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Каждая подкоманда пишет в .api-resources.local.yaml через ARV-111 overlay
- [ ] #2 Diff показывается перед записью; --yes для bypass
- [ ] #3 Повторный annotate не теряет user-edits (conflict markers)
- [ ] #4 ANTHROPIC_API_KEY и --local-model оба supported
- [ ] #5 На Stripe annotate выдаёт минимум 3/4 almetric пункта
<!-- AC:END -->
