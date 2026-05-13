---
id: ARV-179
title: 'checks: unsupported_method — exhaustive HTTP method enumeration'
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

Закрыть schemathesis-only gap по `unsupported_method` (Sentry 115 endpoints,
Resend 39 endpoints — стабильно доминирующая категория на обоих API).

## Проблема

Текущий zond `unsupported_method` check срабатывает на 1 endpoint из 116
overlap'а на Sentry (vs schemathesis: 116/116). Гипотеза: zond пробует
ограниченный набор «других» методов per endpoint, schemathesis — exhaustive
enumeration всех 8 HTTP методов (GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD/TRACE)
минус documented.

## Что выяснить (брейншторм)

- Какой именно набор методов перебирает zond сейчас?
  → `src/checks/unsupported_method.ts` (искать active set).
- Какой алгоритм у schemathesis?
  → schemathesis V4 source: `schemathesis/checks/_unsupported_method.py`.
- Должны ли мы исключать OPTIONS/HEAD из enumeration (они часто implicitly
  работают и дают шум)?
- Anti-FP: какие 4xx/405 mappings считаются valid rejection.

## Скоуп

- расширить enumeration до полного complement set
- сохранить anti-FP guards из m-15
- замер: после фикса повторить parity-run на Sentry, ожидаемая дельта
  +100 unsupported_method findings.

## Зависимости

- ARV-174 (baseline данные) — используем как regression-reference.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 unsupported_method перебирает полный complement set (8 методов минус documented) per endpoint
- [ ] #2 anti-FP regression-pack m-15 остаётся green
- [ ] #3 после фикса parity-замер показывает +100 findings на Sentry overlap'е
<!-- AC:END -->
