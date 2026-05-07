---
id: TASK-52
title: 'T52: Real side-effect testing scaffolding (email sink, webhook receiver)'
status: To Do
assignee: []
created_date: '2026-04-27 16:43'
labels:
  - integration
  - bug-hunting
milestone: m-5
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Самая ценная и рискованная логика email-API — **что письмо реально доставлено**. Spec этого не описывает; только zond run + assertions на response не покажет, что письмо ушло. Аналогично для webhook delivery.

Live-сессия не трогала POST /emails вообще, потому что нет инфраструктуры приёма.

## Что сделать

Документация + helpers для интеграции с тестовыми email-приёмниками:

1. **Mailosaur / Mailpit / Ethereal** — рецепты в ZOND.md:
   ```yaml
   - name: Send email
     POST: /emails
     json:
       to: "{{mailosaur_to}}"
       subject: "Test {{$timestamp}}"
       html: "<p>Body</p>"
     expect:
       status: 200
       body: { id: { capture: msg_id } }

   - name: Verify delivered to mailosaur
     GET: "https://mailosaur.com/api/messages/await?server={{mailosaur_server}}&sentTo={{mailosaur_to}}"
     headers: { Authorization: "Basic {{mailosaur_auth}}" }
     retry_until:
       condition: "status == 200"
       max_attempts: 10
       delay_ms: 2000
     expect:
       status: 200
       body: { subject: { contains: "Test " } }
   ```

2. Аналогично для webhook receivers: webhook.site / svix-cli / ngrok+http-server рецепты.

3. **Опционально:** `zond serve --webhook-receiver` — встроенный HTTP endpoint для приёма webhooks с записью в DB.

## Acceptance

- Готовый recipe для mailosaur в ZOND.md, копируется и работает.
- Recipe для webhook.site как минимум.
- Опциональный встроенный receiver — отдельная подзадача.
<!-- SECTION:DESCRIPTION:END -->
