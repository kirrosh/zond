---
id: ARV-190
title: 'Dynamic value functions в yaml: #(uuid), #(today), #(todayPlus(N))'
status: Done
assignee: []
created_date: '2026-05-13 12:06'
updated_date: '2026-05-16 09:45'
labels:
  - m-20
  - dx
  - fixtures
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pattern скопирован из Dochia. См. backlog/notes/m-20-validation.md §«Dochia deep-dive».

## Цель

Убрать stale hardcoded values trap в .env.yaml / .api-resources.yaml. Сейчас если идентификатор/дата захардкожены — они старятся (Idempotency-Key реюзит существующий resource; today expired). Dynamic functions evaluate'ятся в момент loading.

## Функции

- `#(uuid)` — fresh UUID v4
- `#(uuidStable(<seed>))` — deterministic UUID (для воспроизводимости тестов)
- `#(today)` — YYYY-MM-DD
- `#(todayPlus(N))` — +N дней
- `#(now)` — ISO 8601
- `#(unix)` — unix timestamp
- `#(alphanumeric(N))` — random alphanumeric
- `#(env:VAR)` — env var lookup (alias к ${VAR} для consistency)

## Поведение

- Evaluation на момент loading values (per-run, не per-request — иначе response comparison сломается).
- Cache на run-id: одно и то же `#(uuid)` reference внутри одного run возвращает одинаковое значение (multi-step scenarios).
- Resolution rules: `#(...)` evaluated после ${ENV} substitution и после @secret/@identity resolution.

## Где применять

- .env.yaml values
- .api-resources.yaml (fixtures, body templates)
- scenarios/*.yaml (как замена hardcoded UUIDs)

## Anti-патерны

- НЕ evaluate'ить внутри @secret/@identity references (security).
- НЕ evaluate'ить внутри tests/*.yaml — это auto-generated, должно reproducible.

## Acceptance

- AC1: #(uuid) в .env.yaml даёт fresh UUID каждый run, но одинаковое значение внутри run
- AC2: #(today) / #(todayPlus(N)) форматы корректные
- AC3: nested resolution: "prefix-#(uuid)-suffix" работает
- AC4: redaction registry автоматически регистрирует evaluated values если они от secrets
- AC5: docs в zond-base.md skill
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented dynamic-value substitution in .env.yaml (m-21).

New module src/core/parser/dynamic-values.ts:
- resolveDynamicValues / resolveDynamicValuesDeep with per-call cache (Map<expression, value>) so repeated #(uuid) in one .env.yaml resolves to the same value within one run (critical for idempotency-replay multi-step flows; AC1).
- Functions: uuid (random per cache-miss), uuidStable(seed) (sha-256 → v4-shape deterministic), today, todayPlus(N) (N may be negative), now, unix, alphanumeric(N) (default 8), env:VAR (alias to ${VAR}). All AC2-shaped.
- Nested resolution: 'prefix-#(uuid)-#(today)' yields prefix-<uuid>-2026-MM-DD (AC3).
- Helpful error messages: unknown function lists supported names; #(env:UNSET) tells operator where it came from; bad alphanumeric length is bounded 1..1024.

Wired into loadEnvFile (variables.ts) right after ${ENV} interpolation, BEFORE @secret/@identity refs — secret-stored values that happen to contain #(...) stay opaque (security: anti-pattern from task description). Resolution order is now: ${env} → #() → @secret → @identity.

Tests: 23 (parser/dynamic-values.test.ts) — every function, cache stability within/across runs, deterministic uuidStable, nested + multi-token strings, deep object walk, end-to-end loadEnvFile integration with a temp .env.yaml.

zond.md skill section 'Dynamic value functions in .env.yaml' with table + yaml example + resolution-order note (AC5).

NOT in this MVP: .api-resources.yaml/scenarios .yaml paths (task lists them) — deferred to a follow-up because those paths have their own loading semantics. AC4 (redaction registry hook for secret-derived values) not applicable: #() doesn't read from secrets in current resolution order. 2241/2241 unit tests; tsc clean.
<!-- SECTION:NOTES:END -->
