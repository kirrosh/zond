---
id: ARV-169
title: >-
  checks: cross-call-references — после POST id GET id, diff write-shape vs
  read-shape
status: To Do
assignee: []
created_date: '2026-05-12 12:48'
labels:
  - m-20
  - depth
  - checks
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Цель A из m-20.

Новый rule в checks --phase coverage:
1. Для каждой пары POST /resource → GET /resource/{id} в spec'е (resolved через .api-resources.yaml resource-graph): после успешного POST с body B, выполнить GET с возвращённым id, сравнить response shape с B.
2. Поля, что POST принял (без 4xx) но GET не вернул → MEDIUM 'write-only fields' (нормально для secrets, маркируется только если поле явно read-able по spec'у).
3. Поля, что POST вернул в Location/echo но GET не вернул → HIGH 'state-not-persisted'.
4. Поля, что GET вернул но spec.responses.GET не объявляет → MEDIUM 'undeclared field' (как сейчас, но в cross-call контексте).

Использует существующий resource-graph builder (apis/<name>/.api-resources.yaml + auto-derive). Anti-FP: known timestamp/etag поля исключаются дефолтом.

Acceptance:
- Stripe customers POST→GET выдаёт ≥2 finding (metadata стрипится по умолчанию — это API-quirk; описание счёта tax_exempt vs tax_ids drift)
- Resend / Sentry — ≥1 finding на одном из них
- Anti-FP fixture-test green

Source: feedback round 09 final evaluation §4 item 1.
<!-- SECTION:DESCRIPTION:END -->
