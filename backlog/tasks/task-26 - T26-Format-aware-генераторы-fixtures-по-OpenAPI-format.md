---
id: TASK-26
title: 'T26: Format-aware генераторы fixtures по OpenAPI format'
status: To Do
assignee: []
created_date: '2026-04-27 13:41'
labels:
  - generator
  - robustness
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond generate` сейчас раскладывает все строковые поля в `{{$randomString}}`. Это ловит 422 на CRUD (templates, contacts, webhooks, automations), потому что:
- `domain.name` ждёт hostname/FQDN
- `webhook.url` ждёт URL
- `contact.email` ждёт email

OpenAPI это знает через `format: hostname|uri|email|uuid|date|date-time`, но генератор не использует.

## Что сделать

Мэппинг `format` → встроенные генераторы:

| format | helper |
|---|---|
| email | `{{$randomEmail}}` |
| uri / url | `{{$randomUrl}}` |
| hostname | `{{$randomFqdn}}` |
| uuid | `{{$randomUuid}}` |
| date / date-time | `{{$randomDate}}` / `{{$randomIsoDate}}` |
| ipv4 | `{{$randomIpv4}}` |

Fallback на `$randomString` если `format` не распознан.

## Acceptance

- Сгенерированные suites для Resend (domains, contacts, webhooks) проходят 422-валидацию на первом прогоне.
- Список поддерживаемых helpers документирован в ZOND.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 format → helper mapping реализован
- [ ] #2 Все 6+ форматов покрыты тестами
- [ ] #3 regression-замер: число 422 на сгенерированных suites уменьшилось
<!-- AC:END -->
