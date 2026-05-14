---
id: ARV-190
title: 'Dynamic value functions в yaml: #(uuid), #(today), #(todayPlus(N))'
status: To Do
assignee: []
created_date: '2026-05-13 12:06'
updated_date: '2026-05-13 19:20'
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
