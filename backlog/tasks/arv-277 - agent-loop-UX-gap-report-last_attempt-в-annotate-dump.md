---
id: ARV-277
title: 'agent-loop UX: gap-report + last_attempt в annotate-dump'
status: Done
assignee: []
created_date: '2026-05-17 17:38'
updated_date: '2026-05-17 17:56'
labels:
  - annotate-auto
  - arv-270-followup
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

ARV-270 dogfooding session (Stripe live scan, 2026-05-17) показал две UX-papercuts в agent-loop:

1. **`annotate auto` summary не вычленяет "actionable worklist"**. Сейчас output — список всех resources с inferences. Агент хочет: "вот N resources, для которых я нужен (gap > 0), отсортированы по downstream-impact (сколько dependent endpoints не имеют fixtures)". Это превращает "посмотри лог" в "вот твой TODO list".

2. **`annotate dump` не показывает `last_attempt`** — если zond уже пытался seed-POST для этого resource и получил 400 с конкретной ошибкой Stripe (`parameter_unknown: phases[iterations]`), агент должен это видеть в dump output. Сейчас агенту приходится самому делать `zond request POST ...` чтобы воспроизвести failure mode.

## Acceptance Criteria

- `zond api annotate auto --aspect seed-bodies --gap-report` — печатает только resources с gaps/fallbacks, sorted by `downstream_endpoints_blocked` (endpoint'ы, использующие FK от этого resource'а в path)
- `zond api annotate dump --seed-bodies --with-last-attempt` — добавляет block `{request_body, response_status, response_body, attempted_at}` из последнего seed-POST'а этого resource'а (из runs/results DB)
- Покрытие тестами + skill update (zond/SKILL.md)

## Refs

- ARV-270 dogfooding feedback: `~/Projects/zond-scans/reports/stripe/20260517-202107-arv270-v2/agent-feedback.md`
- ARV-187/270 — feature on which this builds
<!-- SECTION:DESCRIPTION:END -->
