---
id: ARV-250
title: >-
  pivot: severity matrix overhaul — no CRITICAL without end-to-end proof, HIGH
  requires evidence-chain
status: Done
assignee: []
created_date: '2026-05-15 07:03'
updated_date: '2026-05-15 08:01'
labels:
  - m-21
  - pivot
  - severity
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

R18 GitHub-прогон показал: текущая severity-матрица инфлирует HIGH/CRITICAL на пробах без proven impact. Зонд позиционируется как API hygiene scanner для небольших команд (НЕ bug bounty tool — это территория Burp/Caido). Принцип: no evidence → no high severity.

## Цель

Зафиксировать severity-матрицу, основанную на доказанном impact, а не на факте аномалии. Отсутствие CRITICAL в отчёте — не баг, это feature честного отчёта.

## Не покрывает

Перезаписи самих проб (evidence-chain в mass-assignment / CRLF) — отдельные задачи в этом же пивоте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CRITICAL emitted ТОЛЬКО когда зонд собрал end-to-end exploit-цепочку (прочитал данные другого юзера / выполнил действие без auth / прочитал файл). Без цепочки CRITICAL вообще не выпускается.
- [x] #2 HIGH требует evidence-chain хотя бы из 2 запросов (storage + reflection / authz endpoint 200 без токена / persistence confirmed via follow-up GET). Без proof — потолок LOW.
- [x] #3 MEDIUM = sane defaults нарушены (5xx, schema drift, отсутствие rate limit, открытый CORS на sensitive). Не security per se, но fix-worthy.
- [x] #4 LOW = hygiene без proof (санитизация не сделана но reflection не найден, SSRF accept без proof of delivery, inconsistent status codes).
- [x] #5 INFO = статика спеки, стилистика, mass-assignment-no-effect, всё что 'could be intentional'.
- [x] #6 Все существующие пробы пройдены и severity пересчитан под новую матрицу; regression-test фиксирует ожидаемый severity per probe-class.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Unified severity module shipped at src/core/severity/index.ts: 5-tier ladder (critical/high/medium/low/info), capSeverityByProof() with 4 ProofKinds (end_to_end → critical, evidence_chain → high, single_signal → low, static → info), SARIF mapping, bucket helpers. Migrated checks/, lint/, probes to use unified Severity type. Inflation fixes: security-probe 5xx HIGH→LOW with reliability-signal note; mass-assignment silently-ignored LOW→INFO, absent-but-unverifiable MEDIUM→LOW. Lint stats extended with critical/info buckets. JSON schemas regenerated. Regression test at tests/core/severity-matrix.test.ts locks ladder order + proof-cap semantics (9 tests). Per-probe rewrites (evidence-chain follow-ups) remain in scope of ARV-252/253.
<!-- SECTION:FINAL_SUMMARY:END -->
