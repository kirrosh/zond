---
id: TASK-172
title: 'zond doctor: секреты как metadata (set/unset + длина), не raw'
status: To Do
assignee: []
created_date: '2026-05-06 06:55'
labels:
  - secrets
  - doctor
  - ux
dependencies:
  - TASK-166
milestone: m-10
priority: low
---

## Description

## Контекст

Источник: [m-10 feedback round 5](../notes/m-10-secrets-and-redaction/feedback-original.md), §5.

Сейчас агенты в начале сеанса делают `Read .env.yaml`, чтобы понять
«какие переменные есть, что заполнено». Это утечка raw-секретов в
conversation context. После redaction'а токен не утекает в
artifacts, но **в самом файле он всё ещё лежит** (если не
используется `.secrets.yaml` + `@secret`).

Решение для агентов: `zond doctor --api <name> --json` показывает
fixture-pack, где секреты — metadata, не values:

```json
{
  "auth_token": { "secret": true, "set": true, "length": 64 },
  "base_url": { "secret": false, "value": "https://us.sentry.io" },
  "organization_id_or_slug": { "identity": true, "value": "pe-koshelev-..." }
}
```

Агент видит «токен установлен, длина 64» — этого достаточно для
диагностики, raw не нужен. Зависит от TASK-166 (registry знает,
что secret).

## Что сделать

1. **`zond doctor --api <name> --json`** возвращает structured
   payload, где для каждой переменной:
   - `value` — только для non-secret/non-identity.
   - `set: true|false`, `length: <n>` — для всех.
   - `secret: true` — если зарегистрирован в SecretRegistry.
   - `identity: true` — если из `.identity.yaml` (TASK-174).
2. **`zond doctor --api <name>`** (без `--json`, human-readable):
   ```
   ✓ auth_token         set (64 chars, secret)
   ✓ base_url           https://us.sentry.io
   ✓ organization_id    set (16 chars, identity)
   ✗ webhook_url        unset (required for webhook tests)
   ```
3. **Правило:** в любом output `doctor` (json или human) raw-значение
   секрета НЕ показывается, даже с `--no-redact` (это другой контракт
   — `doctor` про metadata, не дебаг).
4. Skill update — упомянуть `zond doctor --json` как entry-point для
   агентов вместо `Read .env.yaml`.

## Acceptance Criteria

- [ ] `zond doctor --api <name> --json` возвращает metadata-only для секретов.
- [ ] Human-readable вывод не показывает raw значения секретов.
- [ ] Поле `secret: true` ставится для всех, что в registry.
- [ ] Поле `length` корректно для set/unset значений.
- [ ] `--no-redact` не меняет поведение `doctor` (metadata-only contract).
- [ ] Skill упоминает `zond doctor --json` как preferred entry-point для агентов.
