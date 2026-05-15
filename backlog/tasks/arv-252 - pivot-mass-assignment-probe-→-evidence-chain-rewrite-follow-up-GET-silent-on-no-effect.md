---
id: ARV-252
title: >-
  pivot: mass-assignment probe → evidence-chain rewrite (follow-up GET, silent
  on no-effect)
status: Done
assignee: []
created_date: '2026-05-15 07:04'
updated_date: '2026-05-15 08:34'
labels:
  - m-21
  - pivot
  - probe
  - mass-assignment
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Текущая проба бьёт LOW при любом 200 на запрос с опасным полем. Но 200 без эффекта — корректное поведение Rails strong params / FastAPI Pydantic extra=ignore / NestJS class-validator. Это шум, который учит команду игнорить отчёт.

## Цель

Пилот общего принципа "no evidence — no finding". Если зонд не доказал, что поле применилось — никакого finding. Если доказал — это уже реальный баг (бывает в маленьких сервисах на голом Express/Flask без allowlist).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Probe выполняет: POST/PATCH с опасным полем (is_admin/role/verified/owner_id/...) → GET созданного/изменённого ресурса → сравнение.
- [x] #2 Поле применилось → MEDIUM/HIGH (зависит от класса поля); это настоящий mass-assignment.
- [x] #3 Поле silently dropped → ТИХО, ни LOW, ни INFO. Не замусориваем отчёт корректным поведением фреймворка.
- [x] #4 GET недоступен / поле не возвращается → INFO 'не смогли проверить', только под --verbose.
- [ ] #5 Curated список опасных полей (is_admin, role, owner_id, verified, plan, status, и т.п.) вынесен в config (можно расширять per-api).
- [x] #6 Regression-fixture: контролируемый mock с реальным mass-assignment ловится HIGH; mock с silently-dropped полем не даёт finding.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Mass-assignment probe rewritten under evidence-chain principle. finaliseSeverity: applied → HIGH (unchanged, already evidence_chain via follow-up GET); absent → INFO (was LOW); silently-ignored → INFO (was LOW after ARV-250, summary unchanged). CLI display filter filterVerdictsForDisplay() suppresses INFO with only 'ignored' outcomes (correct framework behaviour, never finding-worthy) and shows INFO with 'absent' outcomes only under --verbose. JSON envelope always carries the full unfiltered list for agents. New CLI flags: --verbose, --suspect-field name=value (repeatable). extraSuspectFields option threaded through MassAssignmentOptions → probeEndpoint → suspectedExtras for per-run extension. AC#5 partial: CLI flag shipped; per-api spec-extension support (x-zond-suspect-fields) deferred to ARV-189 where the x-zond-* infrastructure lands. Regression test at tests/core/probe/mass-assignment-evidence-chain.test.ts covers all four contract cases (HIGH on applied, INFO+silent on dropped, INFO+verbose-only on absent, custom suspect-field detection).
<!-- SECTION:FINAL_SUMMARY:END -->
