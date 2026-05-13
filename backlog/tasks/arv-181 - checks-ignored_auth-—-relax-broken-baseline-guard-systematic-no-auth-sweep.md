---
id: ARV-181
title: 'checks: ignored_auth — relax broken-baseline guard, systematic no-auth sweep'
status: Done
assignee: []
created_date: '2026-05-13 06:56'
updated_date: '2026-05-13 11:24'
labels:
  - m-18
  - security
  - parity-fix
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Закрыть schemathesis-only gap по `ignored_auth`. Sentry: 1 endpoint
(broken-baseline guard скрывает остальные), Resend: 9 endpoints стабильно.
Это security-классифицированный check, важно для product story.

## Проблема

Schemathesis систематически делает no-auth sweep на всех endpoint'ах с
auth-требованием. Zond — выборочно: на Sentry baseline возвращает 403 →
broken-baseline guard скипает endpoint (172 skip events в Sentry zond-run).
На Resend без этого guard'а check проходит, но всё равно даёт меньше
findings чем schemathesis.

## Что выяснить (брейншторм)

- Где broken-baseline guard сейчас? → `src/checks/ignored_auth.ts`,
  поиск по «baseline returned 403». Когда он correct, а когда — over-guard?
- Schemathesis V4 алгоритм: → `schemathesis/checks/_ignored_auth.py`.
  Что они делают при baseline 403? Похоже, что НЕ скипают, а считают
  expected (т.е. anti-FP другой природы).
- Anti-FP сейчас (m-15): `ignored_auth_anti_fp.ts` — что туда заложено?
  Нужно ли смягчить guard и положиться на anti-FP вместо skip'а?

## Скоуп

- Пересмотреть broken-baseline guard: skip → soft-flag (run check anyway,
  report verdict с note «baseline returned 4xx»).
- Расширить anti-FP под этот случай (если нужно).
- Замер: parity-run на Sentry + Resend, ожидание +20-30 ignored_auth findings.

## Связь с C-блоком m-18

ARV-177 (interactsh OOB-oracle) — независимая security-задача, но fix
ignored_auth может пересекаться по anti-FP логике. Сделать ARV-181 первым.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ignored_auth не скипает по 403/401 baseline; вместо skip — soft-note в finding
- [ ] #2 anti-FP registry расширен под случаи когда baseline сам non-2xx
- [ ] #3 parity-замер: +20-30 ignored_auth findings на Sentry/Resend overlap
<!-- AC:END -->
