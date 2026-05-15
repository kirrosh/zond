---
id: ARV-252
title: >-
  pivot: mass-assignment probe → evidence-chain rewrite (follow-up GET, silent
  on no-effect)
status: To Do
assignee: []
created_date: '2026-05-15 07:04'
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
- [ ] #1 Probe выполняет: POST/PATCH с опасным полем (is_admin/role/verified/owner_id/...) → GET созданного/изменённого ресурса → сравнение.
- [ ] #2 Поле применилось → MEDIUM/HIGH (зависит от класса поля); это настоящий mass-assignment.
- [ ] #3 Поле silently dropped → ТИХО, ни LOW, ни INFO. Не замусориваем отчёт корректным поведением фреймворка.
- [ ] #4 GET недоступен / поле не возвращается → INFO 'не смогли проверить', только под --verbose.
- [ ] #5 Curated список опасных полей (is_admin, role, owner_id, verified, plan, status, и т.п.) вынесен в config (можно расширять per-api).
- [ ] #6 Regression-fixture: контролируемый mock с реальным mass-assignment ловится HIGH; mock с silently-dropped полем не даёт finding.
<!-- AC:END -->
