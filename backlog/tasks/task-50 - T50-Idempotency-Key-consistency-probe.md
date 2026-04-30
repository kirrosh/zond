---
id: TASK-50
title: 'T50: Idempotency-Key consistency probe'
status: To Do
assignee: []
created_date: '2026-04-27 16:42'
labels:
  - bug-hunting
milestone: m-5
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Многие API заявляют поддержку `Idempotency-Key` header (Stripe pattern). Это легко проверяется: послать тот же POST дважды с одним ключом, проверить:

- Оба ответа идентичны.
- Создан **один** ресурс (через follow-up GET в коллекции).

## Что сделать

В `zond generate --idempotency-probe` (или отдельная команда `zond probe-idempotency`):

Для каждого POST endpoint:
```yaml
- name: First POST with Idempotency-Key
  POST: /audiences
  headers: { "Idempotency-Key": "{{$uuid}}" }
  json: { name: "Test {{$randomString}}" }
  expect:
    status: [201, 200]
    body: { id: { capture: first_id } }

- name: Second POST with same key — should return same resource
  POST: /audiences
  headers: { "Idempotency-Key": "{{idempotency_key}}" }   # same as above
  json: { name: "Test {{$randomString}}" }
  expect:
    status: [200, 201]
    body: { id: { equals: "{{first_id}}" } }
```

Если API не поддерживает header — два разных ID → fail с понятным сообщением "API may not honor Idempotency-Key".

## Acceptance

- Probe запускается опционально (не для каждого API, многие не имеют идемпотентности).
- Результат различает три состояния: supported / not-supported / inconsistent.
<!-- SECTION:DESCRIPTION:END -->
