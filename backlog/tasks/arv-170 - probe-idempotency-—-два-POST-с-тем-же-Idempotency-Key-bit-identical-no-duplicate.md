---
id: ARV-170
title: >-
  probe: idempotency — два POST с тем же Idempotency-Key bit-identical, no
  duplicate
status: To Do
assignee: []
created_date: '2026-05-12 12:48'
labels:
  - m-20
  - depth
  - probe
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Цель B из m-20.

Новая probe-команда: zond probe idempotency --api <name>.

Pre-req: в .api-resources.yaml или в spec extensions (x-idempotent: true) объявлен флаг 'этот POST принимает Idempotency-Key'. Auto-derive: если endpoint имеет 'Idempotency-Key' в parameters или Stripe-style global header — считаем idempotent.

Step:
1. POST с body B и Idempotency-Key K → response R1, id resource1.
2. POST с body B и Idempotency-Key K (повтор) → response R2, id resource2.
3. Сравнить R1 == R2 (модулo created_at/updated_at, etag — конфигурируется).
4. GET /list — проверить что resource не дублирован.
5. Cleanup: удалить resource1 (resource2 == resource1 если idempotency корректна).

Findings:
- resource2 != resource1 → HIGH 'idempotency-key not honored' (создан дубликат).
- R1 != R2 (без timestamps) → MEDIUM 'idempotent response not bit-identical'.
- Both POSTs 2xx and resource1 != resource2 → HIGH.

Anti-FP: учесть rate-limit windows для повторного POST.

Acceptance:
- Stripe customers — green (Stripe реально honors Idempotency-Key).
- На каком-то менее зрелом таргете находит ≥1 issue, иначе probe бесполезен (поднять на Resend/любом OpenAPI public API с idempotency-header в spec).

Source: feedback round 09 final evaluation §4 item 3.
<!-- SECTION:DESCRIPTION:END -->
