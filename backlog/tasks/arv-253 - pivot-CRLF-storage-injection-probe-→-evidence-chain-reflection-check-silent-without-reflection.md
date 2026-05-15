---
id: ARV-253
title: >-
  pivot: CRLF / storage-injection probe → evidence-chain (reflection check,
  silent without reflection)
status: Done
assignee: []
created_date: '2026-05-15 07:04'
updated_date: '2026-05-15 09:27'
labels:
  - m-21
  - pivot
  - probe
  - crlf
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас "сервер хранит \\r\\n в строке" бьёт HIGH. Это не security per se — это hygiene-сигнал. HIGH должен быть ТОЛЬКО если зонд сам нашёл reflection в опасном контексте.

## Цель

Второй пилот evidence-chain принципа (после mass-assignment). После двух проб переписанных таким образом — обобщить паттерн в helper для остальных классов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После storage-проба (POST с CRLF/спецсимволами в строковом поле) — follow-up GET и анализ response: попадает ли сохранённое значение в response header (Location, Link, custom), text/plain рендер, RSS/Atom, HTML.
- [x] #2 Reflection в опасном контексте (header / unescaped HTML) → HIGH с evidence-chain в отчёте.
- [x] #3 Reflection в JSON body без escape-проблем → LOW (storage без exploit pathway).
- [x] #4 Нет reflection → INFO 'санитизация не сделана, проверь рендеры вручную'; за default не выпускается в основной отчёт (только --verbose / hygiene category).
- [x] #5 Regression-fixture: mock с reflected header даёт HIGH; mock с stored-but-not-reflected даёт INFO.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Security probe CRLF severity gated on dangerous-context reflection. New classifyInner branches for hit.class === 'crlf': (a) payload reflects in any response header → HIGH (response splitting / header injection evidence_chain); (b) payload reflects in text/html response body → HIGH (XSS-adjacent evidence_chain); (c) payload echoes in JSON body only → LOW (storage observed, no exploit pathway proven); (d) payload accepted with no reflection anywhere → INFO (sanitization signal only, hidden by default). SSRF / open-redirect classes keep existing logic (ARV-254 owns SSRF rebalance). SecuritySeverity union extended with 'info' tier; verdict roll-up, summaryLine, digest titles, SEC_BUCKETS/SEC_SUMMARY/SEC_ZERO buckets updated. CLI --verbose flag controls display of INFO findings (default hides them, JSON envelope unfiltered). security-probe-class.ts collapses info → low for ProbeFindingSeverity envelope (no info tier on public probe wire). Two failing tests updated to reflect new contract; 4-test regression at tests/core/probe/crlf-evidence-chain.test.ts locks the four cases.
<!-- SECTION:FINAL_SUMMARY:END -->
