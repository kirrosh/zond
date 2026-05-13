---
id: ARV-180
title: >-
  checks: status_code_conformance — wider parameter permutations in coverage
  phase
status: Done
assignee: []
created_date: '2026-05-13 06:56'
updated_date: '2026-05-13 11:24'
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

Закрыть schemathesis-only gap по `status_code_conformance`
(Sentry 66 endpoints, Resend 10 endpoints).

## Проблема

Schemathesis ловит больше UndefinedStatusCode (404/401 где documented 200)
за счёт более широких parameter permutations в examples/coverage phases.
Zond ограничен boundary-values + spec examples → меньше edge-case input'ов
→ меньше triggered "undocumented" responses.

## Что выяснить (брейншторм)

- Где сейчас живёт коридор case-generation для status_code_conformance?
  → `src/generator/` + `src/checks/status_code_conformance.ts`.
- Что schemathesis делает в coverage phase для path/query/body params?
  → V4 source: `schemathesis/generation/coverage.py` (или аналог).
- Можно ли переиспользовать существующий generator coverage phase
  (ARV-6) более агрессивно, или нужны новые мутации?
- Anti-FP: 5xx — отдельно (это `not_a_server_error`), не лезть в этот check.

## Скоуп

- расширить case-permutations для path/query params
- логировать каждое полученное status во время coverage, чтобы измерить эффект
- замер: дельта на Sentry overlap'е, ожидание +30-50 status_code findings.

## Не делать

- Не переписывать generator под PBT engine — это m-19, отдельный track.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 status_code_conformance enumerate'ит больше parameter cases в coverage phase
- [ ] #2 anti-FP regression остаётся green; 5xx не leak'ит в этот check
- [ ] #3 parity-замер: +30-50 status_code findings на Sentry overlap
<!-- AC:END -->
