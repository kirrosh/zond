---
id: TASK-47
title: 'T47: Multi-tenant cross-isolation тесты'
status: To Do
assignee: []
created_date: '2026-04-27 16:42'
labels:
  - security
  - bug-hunting
milestone: m-5
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Все текущие тесты в zond используют один API-ключ → один tenant. Дыр в авторизации (cross-tenant data leak) не увидеть. Это самый ценный класс security-багов в SaaS API.

## Что сделать

Поддержка двух (и более) аккаунтов:

1. **Конфигурация:** `.env.yaml` поддерживает `accounts:` — массив:
   ```yaml
   base_url: https://api.example.com
   accounts:
     - name: tenant_a
       auth_token: "xxx"
     - name: tenant_b
       auth_token: "yyy"
   ```

2. **Test syntax:** новые модификаторы для шагов:
   ```yaml
   tests:
     - name: A creates audience
       as: tenant_a
       POST: /audiences
       expect:
         status: 201
         body: { id: { capture: aud_id } }

     - name: B cannot read A's audience
       as: tenant_b
       GET: /audiences/{{aud_id}}
       expect:
         status: [403, 404]   # specifically NOT 200
   ```

3. **Generator:** новая команда/флаг `zond generate --cross-tenant` создаёт isolation-сьюты автоматически для каждого CRUD-ресурса:
   - A creates → B reads (expect 403/404, not 200)
   - A creates → B updates (expect 403/404)
   - A creates → B deletes (expect 403/404)
   - A creates → B lists (A's resource not in result)

## Acceptance

- На реальном API с двумя ключами ловит data-leak (если он есть).
- Добавлен `accounts:` синтаксис в env-формат.
- `as: <account>` модификатор работает per-step.
- Документация.
<!-- SECTION:DESCRIPTION:END -->
